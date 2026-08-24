import { expect } from 'chai';
import { ethers } from 'hardhat';
import { AbiCoder, Wallet } from 'ethers';

describe('InboxDemo + writability leg', function () {
  const coder = AbiCoder.defaultAbiCoder();

  async function deploy() {
    const [deployer, relayerEoa, stranger] = await ethers.getSigners();
    const F = await ethers.getContractFactory('InboxDemo');
    const inbox = await F.deploy(relayerEoa.address);
    return { inbox, relayerEoa, stranger, deployer };
  }

  const makePayload = () =>
    coder.encode(['uint256', 'bytes32', 'uint256', 'uint256'], [0, ('0x' + 'ab'.repeat(32)), 150_000_000n, ethers.parseEther('1.5')]);

  it('executes a message carrying a valid authorized signature', async function () {
    const { inbox, relayerEoa, deployer } = await deploy();
    const payload = makePayload();
    const h = ethers.keccak256(payload);
    const sig = await (relayerEoa as Wallet).signMessage(ethers.getBytes(h));

    await expect(inbox.execute(payload, sig))
      .to.emit(inbox, 'MessageExecuted')
      .withArgs(h, deployer.address, 0, ethers.parseEther('1.5'));
    expect(await inbox.executedPayloads(h)).to.equal(true);
    expect(await inbox.lastAmountReceived()).to.equal(ethers.parseEther('1.5'));
  });

  it('REJECTS signatures from non-authorized keys', async function () {
    const { inbox, stranger } = await deploy();
    const payload = makePayload();
    const h = ethers.keccak256(payload);
    const sig = await (stranger as Wallet).signMessage(ethers.getBytes(h));
    await expect(inbox.connect(stranger).execute(payload, sig)).to.be.revertedWith('BAD_SIGNER');
  });

  it('REJECTS payload replay', async function () {
    const { inbox, relayerEoa } = await deploy();
    const payload = makePayload();
    const h = ethers.keccak256(payload);
    const sig = await (relayerEoa as Wallet).signMessage(ethers.getBytes(h));
    await inbox.execute(payload, sig);
    await expect(inbox.execute(payload, sig)).to.be.revertedWith('REPLAY');
  });

  it('AttestFlowASC emits MessagePublished with settlement payload', async function () {
    // minimal ASC wiring copied from main suite
    const PRECOMPILE = '0x0000000000000000000000000000000000000FD2';
    const B32 = (n: number) => '0x' + n.toString(16).padStart(64, '0');
    const [, , payee, beneficiary] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory('MockBlockProver');
    const mock = await Mock.deploy(true);
    await ethers.provider.send('hardhat_setCode', [
      PRECOMPILE,
      await ethers.provider.getCode(await mock.getAddress()),
    ]);
    const ASC = await ethers.getContractFactory('AttestFlowASC');
    const asc = await ASC.deploy();
    await (await ethers.getSigners())[0].sendTransaction({ to: await asc.getAddress(), value: ethers.parseEther('1') });
    await asc.createPolicy(1, ethers.ZeroAddress, 18, payee.address, 1, beneficiary.address, ethers.parseEther('1'));

    const txBytes = coder.encode(['uint8', 'bytes[]'], [
      2,
      [
        coder.encode(['uint64','uint64','address','bool','address','uint256','bytes'], [0n,100000n,payee.address,false,payee.address,ethers.parseEther('1'),'0x']),
        coder.encode(['uint64','uint128','uint128','tuple(address,bytes32[])[]','uint8','bytes32','bytes32'], [11155111n,1n,1n,[],1,B32(0),B32(1)]),
        coder.encode(['uint8','uint64','tuple(address,bytes32[],bytes)[]','bytes'], [1,21000n,[],'0x'+'00'.repeat(256)]),
      ],
    ]);

    await expect(
      asc.settle(0, 1, 11550869n, 0n, txBytes, { root: B32(1), siblings: [] }, { lowerEndpointDigest: B32(2), roots: [] }),
    ).to.emit(asc, 'MessagePublished');
  });
});
