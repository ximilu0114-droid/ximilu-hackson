import { expect } from 'chai';
import { ethers } from 'hardhat';
import { AbiCoder, ZeroAddress } from 'ethers';

const PRECOMPILE = '0x0000000000000000000000000000000000000FD2';
const coder = AbiCoder.defaultAbiCoder();
const B32 = (n: number) => '0x' + n.toString(16).padStart(64, '0');

// ---- Encoding v1 builders (byte-compatible with @gluwa/usc-sdk abiEncode) ----

function chunkCommon(tx: {
  from: string;
  to: string | null;
  value?: bigint;
  data?: string;
}): string {
  return coder.encode(
    ['uint64', 'uint64', 'address', 'bool', 'address', 'uint256', 'bytes'],
    [0n, 100000n, tx.from, tx.to == null, tx.to ?? ZeroAddress, tx.value ?? 0n, tx.data ?? '0x'],
  );
}

function chunkType2(): string {
  return coder.encode(
    ['uint64', 'uint128', 'uint128', 'tuple(address,bytes32[])[]', 'uint8', 'bytes32', 'bytes32'],
    [11155111n, 2_000_000_000n, 30_000_000_000n, [], 1, B32(0), B32(1)],
  );
}

function chunkReceipt(status: number): string {
  return coder.encode(
    ['uint8', 'uint64', 'tuple(address,bytes32[],bytes)[]', 'bytes'],
    [status, 21000n, [], '0x' + '00'.repeat(256)],
  );
}

/** Type-2 tx encoded exactly like the SDK production encoder. */
function encodeTx(
  tx: { from: string; to: string | null; value?: bigint; data?: string },
  status = 1,
): string {
  return coder.encode(['uint8', 'bytes[]'], [2, [chunkCommon(tx), chunkType2(), chunkReceipt(status)]]);
}

const erc20TransferData = (recipient: string, amount: bigint): string =>
  '0xa9059cbb' + coder.encode(['address', 'uint256'], [recipient, amount]).slice(2);

const erc20TransferFromData = (sender: string, recipient: string, amount: bigint): string =>
  '0x23b872dd' + coder.encode(['address', 'address', 'uint256'], [sender, recipient, amount]).slice(2);

const sourceTxId = () =>
  ethers.solidityPackedKeccak256(['uint64', 'uint64', 'uint64'], [CHAIN_KEY, HEIGHT, TX_INDEX]);

// ---- Fixture constants ----
const CHAIN_KEY = 1;
const TOKEN = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'; // native USDC on Sepolia
const HEIGHT = 11550869n;
const TX_INDEX = 0n;
const MIN_AMOUNT = 100_000_000n; // 100 USDC (6 decimals)
const RATIO_E18 = 10_000_000_000_000_000n; // 0.01 CTC per 1 USDC

describe('AttestFlowASC', function () {
  let asc: any;
  let mockTrue: any;
  let mockFalse: any;
  let owner: any, agent: any, payee: any, beneficiary: any, stranger: any;

  const proofArgs = {
    merkleProof: { root: B32(0xa), siblings: [{ hash: B32(0xb), isLeft: false }] },
    continuityProof: { lowerEndpointDigest: B32(0xc), roots: [B32(0xd)] },
  };

  async function setProver(mock: any) {
    await ethers.provider.send('hardhat_setCode', [
      PRECOMPILE,
      await ethers.provider.getCode(await mock.getAddress()),
    ]);
  }

  beforeEach(async function () {
    [owner, agent, payee, beneficiary, stranger] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory('MockBlockProver');
    mockTrue = await Mock.deploy(true);
    mockFalse = await Mock.deploy(false);
    await setProver(mockTrue);

    const ASC = await ethers.getContractFactory('AttestFlowASC');
    asc = await ASC.deploy();

    // fund escrow with 10 native CTC
    await owner.sendTransaction({ to: await asc.getAddress(), value: ethers.parseEther('10') });

    await asc.createPolicy(
      CHAIN_KEY,
      TOKEN,
      6,
      payee.address,
      MIN_AMOUNT,
      beneficiary.address,
      CHAIN_KEY,
      beneficiary.address,
      RATIO_E18,
    );
    await asc.setOperator(agent.address, true);
  });

  const settleCall = (txBytes: string, policyId = 0, height = HEIGHT, txIndex = TX_INDEX) =>
    asc.connect(agent).settle(policyId, CHAIN_KEY, height, txIndex, txBytes, proofArgs.merkleProof, proofArgs.continuityProof);

  it('settles a verified ERC20 payment: releases escrow + records credit', async function () {
    const amount = 150_000_000n; // 150 USDC
    const txBytes = encodeTx({
      from: stranger.address,
      to: TOKEN,
      data: erc20TransferData(payee.address, amount),
    });

    const beforeB = await ethers.provider.getBalance(beneficiary.address);
    await expect(settleCall(txBytes))
      .to.emit(asc, 'PaymentSettled')
      .withArgs(
        0,
        sourceTxId(),
        stranger.address,
        TOKEN,
        amount,
        beneficiary.address,
        ethers.parseEther('1.5'),
        HEIGHT,
        TX_INDEX,
      );

    expect((await ethers.provider.getBalance(beneficiary.address)) - beforeB).to.equal(ethers.parseEther('1.5'));
    expect(await asc.creditOf(beneficiary.address)).to.equal(ethers.parseEther('1.5'));
    expect(await asc.totalSettledPerPolicy(0)).to.equal(1);
    expect(await asc.settledTxs(sourceTxId())).to.equal(true);
    expect(await ethers.provider.getBalance(await asc.getAddress())).to.equal(ethers.parseEther('8.5'));
  });

  it('REJECTS a source transaction whose receipt status != 0x1 (core security path)', async function () {
    // The precompile only proves inclusion — a FAILED source tx still verifies.
    const txBytes = encodeTx(
      { from: stranger.address, to: TOKEN, data: erc20TransferData(payee.address, 150_000_000n) },
      0, // status = 0 → reverted source tx
    );
    await expect(settleCall(txBytes)).to.be.revertedWith('SOURCE_TX_FAILED');
    // must not mark the tx as settled nor release anything
    expect(await asc.settledTxs(sourceTxId())).to.equal(false);
    expect(await ethers.provider.getBalance(await asc.getAddress())).to.equal(ethers.parseEther('10'));
  });

  it('settles an ERC20 transferFrom payment (allowance flow)', async function () {
    const amount = 200_000_000n; // 200 USDC
    const txBytes = encodeTx({
      from: stranger.address,
      to: TOKEN,
      data: erc20TransferFromData(stranger.address, payee.address, amount),
    });
    const beforeB = await ethers.provider.getBalance(beneficiary.address);
    await expect(settleCall(txBytes))
      .to.emit(asc, 'PaymentSettled')
      .withArgs(
        0,
        sourceTxId(),
        stranger.address,
        TOKEN,
        amount,
        beneficiary.address,
        ethers.parseEther('2'),
        HEIGHT,
        TX_INDEX,
      );
    expect((await ethers.provider.getBalance(beneficiary.address)) - beforeB).to.equal(ethers.parseEther('2'));
  });

  it('REJECTS replaying the same source transaction', async function () {
    const txBytes = encodeTx({ from: stranger.address, to: TOKEN, data: erc20TransferData(payee.address, 120_000_000n) });
    await settleCall(txBytes);
    await expect(settleCall(txBytes)).to.be.revertedWith('ALREADY_SETTLED');
  });

  it('REJECTS replaying a proof under a caller-invented transaction index', async function () {
    const txBytes = encodeTx({ from: stranger.address, to: TOKEN, data: erc20TransferData(payee.address, 120_000_000n) });
    await settleCall(txBytes);
    await expect(settleCall(txBytes, 0, HEIGHT, 1n)).to.be.revertedWith('TX_INDEX_MISMATCH');
  });

  it('REJECTS payments below policy minimum', async function () {
    const txBytes = encodeTx({ from: stranger.address, to: TOKEN, data: erc20TransferData(payee.address, 99_999_999n) });
    await expect(settleCall(txBytes)).to.be.revertedWith('AMOUNT_TOO_LOW');
  });

  it('REJECTS transfers whose recipient is not the watched payee', async function () {
    const txBytes = encodeTx({
      from: stranger.address,
      to: TOKEN,
      data: erc20TransferData(stranger.address, 500_000_000n),
    });
    await expect(settleCall(txBytes)).to.be.revertedWith('POLICY_NOT_MATCHED');
  });

  it('settles a NATIVE currency payment when policy token == address(0)', async function () {
    await asc.createPolicy(
      CHAIN_KEY,
      ZeroAddress,
      18,
      payee.address,
      ethers.parseEther('1'),
      beneficiary.address,
      CHAIN_KEY,
      beneficiary.address,
      ethers.parseEther('1'),
    );
    const txBytes = encodeTx({ from: stranger.address, to: payee.address, value: ethers.parseEther('2') });
    const beforeB = await ethers.provider.getBalance(beneficiary.address);
    await settleCall(txBytes, 1);
    expect((await ethers.provider.getBalance(beneficiary.address)) - beforeB).to.equal(ethers.parseEther('2'));
  });

  it('REVERTS settlement when the cryptographic proof is invalid', async function () {
    await setProver(mockFalse); // precompile now rejects every proof
    const txBytes = encodeTx({ from: stranger.address, to: TOKEN, data: erc20TransferData(payee.address, 150_000_000n) });
    await expect(settleCall(txBytes)).to.be.reverted; // INVALID_PROOF bubbles from precompile
    expect(await asc.settledTxs(sourceTxId())).to.equal(false);
  });

  it('enforces access control', async function () {
    const txBytes = encodeTx({ from: stranger.address, to: TOKEN, data: erc20TransferData(payee.address, 150_000_000n) });
    await expect(
      asc.connect(stranger).settle(0, CHAIN_KEY, HEIGHT, TX_INDEX, txBytes, proofArgs.merkleProof, proofArgs.continuityProof),
    ).to.be.revertedWith('NOT_OPERATOR');
    await expect(
      asc.connect(stranger).createPolicy(
        1,
        ZeroAddress,
        18,
        payee.address,
        1,
        beneficiary.address,
        CHAIN_KEY,
        beneficiary.address,
        1,
      ),
    ).to.be.revertedWith('NOT_OWNER');
  });

  it('rejects duplicate policies and inactive policies', async function () {
    await expect(
      asc.createPolicy(
        CHAIN_KEY,
        TOKEN,
        6,
        payee.address,
        MIN_AMOUNT,
        beneficiary.address,
        CHAIN_KEY,
        beneficiary.address,
        RATIO_E18,
      ),
    ).to.be.revertedWith('POLICY_EXISTS');

    await asc.createPolicy(
      CHAIN_KEY,
      ZeroAddress,
      18,
      payee.address,
      1,
      beneficiary.address,
      CHAIN_KEY,
      beneficiary.address,
      1,
    ); // id=1
    await asc.setPolicyActive(1, false);
    const txBytes = encodeTx({ from: stranger.address, to: payee.address, value: 123n });
    await expect(settleCall(txBytes, 1)).to.be.revertedWith('POLICY_INACTIVE');
  });
});
