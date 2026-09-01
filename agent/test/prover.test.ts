import assert from 'node:assert/strict';
import test from 'node:test';
import { AbiCoder, getAddress } from 'ethers';

import { builtinParse } from '../src/llm.js';
import {
  computeTransactionIndex,
  decodeErc20Call,
  ensurePolicy,
  sourceTransactionId,
} from '../src/prover.js';

const coder = AbiCoder.defaultAbiCoder();
const wallet = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';

test('derives transaction index from Merkle-path laterality', () => {
  const index = computeTransactionIndex({
    siblings: [
      { isLeft: true },
      { isLeft: false },
      { isLeft: true },
      { isLeft: true },
    ],
  });
  assert.equal(index, 13n);
});

test('rejects Merkle paths that cannot fit the precompile uint64 index', () => {
  assert.throws(
    () => computeTransactionIndex({ siblings: Array(65).fill({ isLeft: false }) }),
    /deeper than uint64/,
  );
});

test('builds a stable replay key from the proof-bound location', () => {
  assert.equal(
    sourceTransactionId(1, 123, 13),
    sourceTransactionId(1n, 123n, 13n),
  );
  assert.notEqual(sourceTransactionId(1, 123, 13), sourceTransactionId(1, 123, 14));
});

test('decodes transfer and transferFrom calldata amounts', () => {
  const transfer =
    '0xa9059cbb' + coder.encode(['address', 'uint256'], [recipient, 150n]).slice(2);
  const transferFrom =
    '0x23b872dd' +
    coder.encode(['address', 'address', 'uint256'], [wallet, recipient, 275n]).slice(2);
  assert.deepEqual(decodeErc20Call(transfer), {
    recipient: getAddress(recipient),
    amount: 150n,
  });
  assert.deepEqual(decodeErc20Call(transferFrom), {
    recipient: getAddress(recipient),
    amount: 275n,
  });
  assert.equal(decodeErc20Call('0xdeadbeef'), null);
});

test('binds "my payment" rules to the agent wallet and rejects unsafe ratios', () => {
  const parsed = builtinParse('当我在 Sepolia 收到 ≥100 USDC 时，按 10% 释放', wallet);
  assert.equal(parsed.payee, wallet);
  assert.equal(parsed.minAmount, 100_000_000n);
  assert.equal(parsed.payoutRatioE18, 100_000_000_000_000_000n);
  assert.throws(() => builtinParse('收到 100 USDC 后释放 101%', wallet), /at most 100/);
});

test('preserves native ETH as token=null instead of falling back to USDC', () => {
  const parsed = builtinParse('当我在 Sepolia 收到 ≥0.01 ETH 时，按 10% 释放', wallet);
  assert.equal(parsed.token, null);
  assert.equal(parsed.minAmount, 10_000_000_000_000_000n);
});

test('reuses an existing policy only when every money and destination field matches', async () => {
  const ratio = 100_000_000_000_000_000n;
  const policy = {
    chainKey: 1n,
    token: '0x0000000000000000000000000000000000000000',
    tokenDecimals: 18n,
    payee: wallet,
    minAmount: 10_000_000_000_000_000n,
    beneficiary: wallet,
    destChainKey: 1n,
    destContract: recipient,
    payoutRatioE18: ratio,
    active: true,
  };
  const fakeAsc: any = {
    findPolicy: async () => 0n,
    getPolicy: async () => policy,
    createPolicy: async () => {
      throw new Error('should not create');
    },
  };
  assert.equal(
    await ensurePolicy(
      fakeAsc,
      wallet,
      {
        token: null,
        minAmount: policy.minAmount.toString(),
        payoutRatioE18: ratio.toString(),
      },
      wallet,
      recipient,
    ),
    0,
  );
});

test('fails closed instead of silently reusing a stale policy', async () => {
  const fakeAsc: any = {
    findPolicy: async () => 0n,
    getPolicy: async () => ({
      chainKey: 1n,
      token: '0x0000000000000000000000000000000000000000',
      tokenDecimals: 18n,
      payee: wallet,
      minAmount: 10_000_000_000_000_000n,
      beneficiary: wallet,
      destChainKey: 1n,
      destContract: recipient,
      payoutRatioE18: 50_000_000_000_000_000n,
      active: true,
    }),
  };
  await assert.rejects(
    ensurePolicy(
      fakeAsc,
      wallet,
      {
        token: null,
        minAmount: 10_000_000_000_000_000n,
        payoutRatioE18: 100_000_000_000_000_000n,
      },
      wallet,
      recipient,
    ),
    /EXISTING_POLICY_DOES_NOT_MATCH_RULE/,
  );
});
