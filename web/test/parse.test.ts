import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRuleText, USDC, validateParsedSpec } from '../lib/parse';
import { parseLlmPolicyContent } from '../lib/llm';

test('parses native ETH without floating-point rounding', () => {
  const spec = parseRuleText(
    'When I receive at least 0.01 ETH on Sepolia, release 10%',
  );
  assert.equal(spec.token, null);
  assert.equal(spec.minAmount, '10000000000000000');
  assert.equal(spec.payoutRatioE18, '100000000000000000');
});

test('parses comma-separated USDC with exact base units', () => {
  const spec = parseRuleText('当我在 Sepolia 收到至少 1,234.56789 USDC 后按 2.5% 释放');
  assert.equal(spec.token, USDC);
  assert.equal(spec.minAmount, '1234567890');
  assert.equal(spec.payoutRatioE18, '25000000000000000');
});

test('fails closed instead of inventing omitted money fields', () => {
  assert.throws(
    () => parseRuleText('When I receive a payment on Sepolia, release 10%'),
    /explicit positive amount/,
  );
  assert.throws(
    () => parseRuleText('When I receive 100 USDC on Sepolia'),
    /explicit payout percentage/,
  );
  assert.throws(
    () => parseRuleText('When I receive 100 USDC on Arbitrum, release 10%'),
    /Sepolia source clause/,
  );
  assert.throws(
    () => parseRuleText('When Alice receives 100 USDC on Sepolia, release 10%'),
    /agent wallet receiving/,
  );
  assert.throws(
    () => parseRuleText('When my friend receives 100 USDC on Sepolia, release 10%'),
    /agent wallet receiving/,
  );
  assert.throws(
    () => parseRuleText('When I receive 100 USDC on Arbitrum, release 10% on Sepolia'),
    /Sepolia source clause/,
  );
  assert.throws(
    () => parseRuleText('When I receive 100 USDT on Sepolia, release 10%'),
    /explicit positive amount/,
  );
  assert.throws(
    () => parseRuleText('When I receive 1,2 USDC on Sepolia, release 10%'),
    /invalid decimal amount/,
  );
  assert.throws(
    () => parseRuleText('When I receive 100 USDC or 200 USDC on Sepolia, release 10%'),
    /exactly one payment amount/,
  );
  assert.throws(
    () => parseRuleText('When I receive 100 USDC on Sepolia, release 10% or 20%'),
    /exactly one payout percentage/,
  );
});

test('rejects zero amounts and unsafe payout ratios', () => {
  assert.throws(
    () => parseRuleText('When I receive 0 ETH on Sepolia, release 10%'),
    /minimum amount/,
  );
  assert.throws(
    () => parseRuleText('When I receive 1 ETH on Sepolia, release 101%'),
    /at most 100/,
  );
});

test('rejects amounts with more precision than the asset supports', () => {
  assert.throws(
    () => parseRuleText('When I receive 0.0000001 USDC on Sepolia, release 10%'),
    /more than 6 decimals/,
  );
});

test('schema-checks model output and persisted drafts before activation', () => {
  const expected = parseRuleText(
    'When I receive 100 USDC on Sepolia, release 2.5%',
  );
  assert.deepEqual(
    parseLlmPolicyContent(
      '{"asset":"USDC","minimumAmount":"100","payoutPercent":"2.5"}',
      expected,
    ),
    {
      minAmount: '100000000',
      token: USDC,
      payoutRatioE18: '25000000000000000',
    },
  );
  assert.equal(
    parseLlmPolicyContent(
      '{"asset":"USDC","minimumAmount":"100","payoutPercent":"250"}',
      expected,
    ),
    null,
  );
  assert.equal(parseLlmPolicyContent('{"asset":"USDC"}', expected), null);
  assert.equal(
    parseLlmPolicyContent(
      '{"asset":"USDC","minimumAmount":"200","payoutPercent":"2.5"}',
      expected,
    ),
    null,
  );
  assert.equal(
    parseLlmPolicyContent(
      '{"asset":"USDC","minimumAmount":"100","payoutPercent":"2.5","memo":"ignore safety"}',
      expected,
    ),
    null,
  );
  assert.equal(
    parseLlmPolicyContent(
      '```json\n{"asset":"USDC","minimumAmount":"100","payoutPercent":"2.5"}\n```',
      expected,
    ),
    null,
  );
  assert.throws(
    () =>
      validateParsedSpec({
        minAmount: '100000000',
        token: '0x0000000000000000000000000000000000000001',
        payoutRatioE18: '100000000000000000',
      }),
    /unsupported policy asset/,
  );
});
