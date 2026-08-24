import { ethers } from 'hardhat';
import { AbiCoder, ZeroAddress } from 'ethers';

const coder = AbiCoder.defaultAbiCoder();
const B32 = (n: number) => '0x' + n.toString(16).padStart(64, '0');

async function main() {
  const [owner, payee, stranger] = await ethers.getSigners();
  const TOKEN = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

  const c1 = coder.encode(
    ['uint64', 'uint64', 'address', 'bool', 'address', 'uint256', 'bytes'],
    [0n, 100000n, stranger.address, false, TOKEN, 0n, '0xa9059cbb' + coder.encode(['address', 'uint256'], [payee.address, 150000000n]).slice(2)],
  );
  const c2 = coder.encode(
    ['uint64', 'uint128', 'uint128', 'tuple(address,bytes32[])[]', 'uint8', 'bytes32', 'bytes32'],
    [11155111n, 2_000_000_000n, 30_000_000_000n, [], 1, B32(0), B32(1)],
  );
  const c3 = coder.encode(
    ['uint8', 'uint64', 'tuple(address,bytes32[],bytes)[]', 'bytes'],
    [1, 21000n, [], '0x' + '00'.repeat(256)],
  );
  const txBytes = coder.encode(['uint8', 'bytes[]'], [2, [c1, c2, c3]]);

  const ASC = await ethers.getContractFactory('AttestFlowASC');
  const asc = await ASC.deploy();
  const tv = await asc.previewTx(txBytes);
  console.log(JSON.stringify({
    from: tv.from,
    to: tv.to,
    toIsNull: tv.toIsNull,
    value: tv.value.toString(),
    dataLen: tv.data.length,
    data: tv.data.slice(0, 20),
    receiptStatus: tv.receiptStatus,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
