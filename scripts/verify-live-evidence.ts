import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  ZeroAddress,
  getAddress,
  keccak256,
  solidityPackedKeccak256,
} from 'ethers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = JSON.parse(
  fs.readFileSync(path.join(root, 'evidence/live-e2e-v2.json'), 'utf8'),
);
const ascDeployment = JSON.parse(
  fs.readFileSync(path.join(root, 'deployments/attestflow-cc3-testnet.json'), 'utf8'),
);
const inboxDeployment = JSON.parse(
  fs.readFileSync(path.join(root, 'deployments/inboxdemo-sepolia.json'), 'utf8'),
);
const ascArtifact = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      'contracts/artifacts/contracts/AttestFlowASC.sol/AttestFlowASC.json',
    ),
    'utf8',
  ),
);
const inboxArtifact = JSON.parse(
  fs.readFileSync(
    path.join(root, 'contracts/artifacts/contracts/InboxDemo.sol/InboxDemo.json'),
    'utf8',
  ),
);

let checkCount = 0;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`EVIDENCE_MISMATCH: ${message}`);
  checkCount += 1;
}

function sameAddress(actual: string, expected: string): boolean {
  return getAddress(actual) === getAddress(expected);
}

async function main() {
  const sepolia = new JsonRpcProvider(
    process.env.SEPOLIA_RPC_URL ??
      'https://ethereum-sepolia-rpc.publicnode.com',
  );
  const cc3 = new JsonRpcProvider(
    process.env.CREDITCOIN_TESTNET_RPC_URL ??
      'https://rpc.cc3-testnet.creditcoin.network',
  );

  const [
    sourceTx,
    sourceReceipt,
    deploymentReceipt,
    settlementReceipt,
    deliveryReceipt,
    sepoliaNetwork,
    cc3Network,
  ] =
    await Promise.all([
      sepolia.getTransaction(evidence.source.txHash),
      sepolia.getTransactionReceipt(evidence.source.txHash),
      cc3.getTransactionReceipt(evidence.settlement.deploymentTxHash),
      cc3.getTransactionReceipt(evidence.settlement.txHash),
      sepolia.getTransactionReceipt(evidence.delivery.txHash),
      sepolia.getNetwork(),
      cc3.getNetwork(),
    ]);
  check(sourceTx && sourceReceipt, 'source transaction is unavailable');
  check(deploymentReceipt, 'ASC deployment transaction is unavailable');
  check(settlementReceipt, 'settlement transaction is unavailable');
  check(deliveryReceipt, 'delivery transaction is unavailable');
  check(sepoliaNetwork.chainId === BigInt(evidence.source.chainId), 'Sepolia chain id');
  check(cc3Network.chainId === BigInt(evidence.settlement.chainId), 'CC3 chain id');
  check(sourceReceipt.status === 1, 'source transaction did not succeed');
  check(deploymentReceipt.status === 1, 'ASC deployment did not succeed');
  check(settlementReceipt.status === 1, 'CC3 settlement did not succeed');
  check(deliveryReceipt.status === 1, 'destination execution did not succeed');
  check(sourceReceipt.blockNumber === evidence.source.blockNumber, 'source block');
  check(sourceReceipt.index === evidence.source.txIndex, 'source transaction index');
  check(sameAddress(sourceTx.from, evidence.source.payer), 'source payer');
  check(sameAddress(sourceTx.to!, evidence.source.payee), 'source payee');
  check(sourceTx.value.toString() === evidence.source.amountWei, 'source amount');
  check(sourceTx.data === '0x', 'source transaction is not a direct native payment');
  check(
    sameAddress(deploymentReceipt.contractAddress!, evidence.settlement.contract),
    'ASC deployment address',
  );
  check(
    deploymentReceipt.blockNumber === ascDeployment.blockNumber,
    'ASC deployment block',
  );
  check(
    sameAddress(deploymentReceipt.from, evidence.source.payee),
    'ASC deployer',
  );

  const expectedSourceTxId = solidityPackedKeccak256(
    ['uint64', 'uint64', 'uint64'],
    [evidence.source.chainKey, sourceReceipt.blockNumber, sourceReceipt.index],
  );
  check(expectedSourceTxId === evidence.settlement.sourceTxId, 'sourceTxId');
  check(
    sameAddress(settlementReceipt.to!, evidence.settlement.contract),
    'settlement contract',
  );
  check(
    sameAddress(deliveryReceipt.to!, evidence.delivery.contract),
    'delivery contract',
  );

  const ascInterface = new Interface(ascDeployment.abi);
  const inboxInterface = new Interface(inboxDeployment.abi);
  let settled: any;
  let published: any;
  let executed: any;
  for (const log of settlementReceipt.logs) {
    try {
      const parsed = ascInterface.parseLog(log);
      if (parsed?.name === 'PaymentSettled') settled = parsed;
      if (parsed?.name === 'MessagePublished') published = parsed;
    } catch {}
  }
  for (const log of deliveryReceipt.logs) {
    try {
      const parsed = inboxInterface.parseLog(log);
      if (parsed?.name === 'MessageExecuted') executed = parsed;
    } catch {}
  }
  check(settled && published && executed, 'required protocol events');
  check(settled.args.policyId.toString() === evidence.settlement.policyId, 'settled policy');
  check(settled.args.sourceTxId === expectedSourceTxId, 'settled sourceTxId');
  check(sameAddress(settled.args.payer, evidence.source.payer), 'settled payer');
  check(sameAddress(settled.args.token, ZeroAddress), 'settled native token');
  check(settled.args.amount.toString() === evidence.source.amountWei, 'settled amount');
  check(
    sameAddress(settled.args.beneficiary, evidence.source.payee),
    'settlement beneficiary',
  );
  check(
    settled.args.releasedAmount.toString() === evidence.settlement.releasedWei,
    'released amount',
  );
  check(
    settled.args.srcHeight.toString() === evidence.source.blockNumber.toString(),
    'settled source height',
  );
  check(
    settled.args.srcTxIndex.toString() === evidence.source.txIndex.toString(),
    'settled source index',
  );
  check(
    published.args.destChainKey.toString() === evidence.message.destChainKey,
    'destination chain key',
  );
  check(
    sameAddress(published.args.destContract, evidence.message.destContract),
    'destination contract',
  );

  const payload: string = published.args.payload;
  const payloadHash = keccak256(payload);
  const [policyId, sourceTxId, amount, released] =
    AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'bytes32', 'uint256', 'uint256'],
      payload,
    );
  check(payloadHash === evidence.message.payloadHash, 'published payload hash');
  check(policyId.toString() === evidence.settlement.policyId, 'payload policy');
  check(sourceTxId === expectedSourceTxId, 'payload sourceTxId');
  check(amount.toString() === evidence.source.amountWei, 'payload amount');
  check(released.toString() === evidence.settlement.releasedWei, 'payload release');
  check(executed.args.payloadHash === payloadHash, 'delivered payload hash');
  check(
    sameAddress(executed.args.executor, evidence.source.payee),
    'destination executor',
  );
  check(executed.args.policyId === policyId, 'delivered policy');
  check(executed.args.released === released, 'delivered release');

  const asc = new Contract(evidence.settlement.contract, ascArtifact.abi, cc3);
  const inbox = new Contract(evidence.delivery.contract, inboxArtifact.abi, sepolia);
  const [
    settledOnChain,
    executedOnChain,
    policy,
    owner,
    operator,
    authorizedRelayer,
    lastPayloadHash,
    lastAmountReceived,
    ascCode,
    inboxCode,
  ] = await Promise.all([
    asc.settledTxs(expectedSourceTxId),
    inbox.executedPayloads(payloadHash),
    asc.getPolicy(policyId),
    asc.owner(),
    asc.operators(evidence.source.payee),
    inbox.authorizedRelayer(),
    inbox.lastPayloadHash(),
    inbox.lastAmountReceived(),
    cc3.getCode(evidence.settlement.contract),
    sepolia.getCode(evidence.delivery.contract),
  ]);
  check(settledOnChain, 'ASC replay guard is not set');
  check(executedOnChain, 'Inbox replay guard is not set');
  check(policy.chainKey.toString() === evidence.source.chainKey.toString(), 'policy chain key');
  check(sameAddress(policy.token, ZeroAddress), 'policy native token');
  check(Number(policy.tokenDecimals) === 18, 'policy native decimals');
  check(sameAddress(policy.payee, evidence.source.payee), 'policy payee');
  check(policy.minAmount.toString() === evidence.source.amountWei, 'policy threshold');
  check(sameAddress(policy.beneficiary, evidence.source.payee), 'policy beneficiary');
  check(
    policy.destChainKey.toString() === evidence.message.destChainKey,
    'policy destination chain',
  );
  check(
    sameAddress(policy.destContract, evidence.message.destContract),
    'policy destination contract',
  );
  const expectedRatio =
    (BigInt(evidence.settlement.releasedWei) * 10n ** 18n) /
    BigInt(evidence.source.amountWei);
  check(policy.payoutRatioE18 === expectedRatio, 'policy payout ratio');
  check(policy.active, 'policy is inactive');
  check(sameAddress(owner, evidence.source.payee), 'ASC owner');
  check(operator, 'agent is not an ASC operator');
  check(
    sameAddress(authorizedRelayer, evidence.source.payee),
    'Inbox authorized relayer',
  );
  check(lastPayloadHash === payloadHash, 'Inbox last payload hash');
  check(lastAmountReceived === released, 'Inbox last released amount');
  check(
    keccak256(ascCode) === keccak256(ascArtifact.deployedBytecode),
    'deployed ASC bytecode differs from local source build',
  );
  check(
    keccak256(inboxCode) === keccak256(inboxArtifact.deployedBytecode),
    'deployed Inbox bytecode differs from local source build',
  );

  console.log(
    JSON.stringify(
      {
        status: 'SUCCESS',
        source: evidence.source.txHash,
        settlement: evidence.settlement.txHash,
        delivery: evidence.delivery.txHash,
        sourceTxId: expectedSourceTxId,
        payloadHash,
        checks: checkCount,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
