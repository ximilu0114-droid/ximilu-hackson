import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRuleText, USDC } from '../lib/parse';

test('parses native ETH without floating-point rounding', () => {
  const spec = parseRuleText(
    'When I receive at least 0.01 ETH on Sepolia, release 10%',
  );
  assert.equal(spec.token, null);
  assert.equal(spec.minAmount, '10000000000000000');
  assert.equal(spec.payoutRatioE18, '100000000000000000');
});

test('parses comma-separated USDC with exact base units', () => {
  const spec = parseRuleText('收到至少 1,234.56789 USDC 后按 2.5% 释放');
  assert.equal(spec.token, USDC);
  assert.equal(spec.minAmount, '1234567890');
  assert.equal(spec.payoutRatioE18, '25000000000000000');
});

test('uses the documented deterministic defaults for an underspecified rule', () => {
  const spec = parseRuleText('watch my Sepolia invoice');
  assert.equal(spec.token, USDC);
  assert.equal(spec.minAmount, '100000000');
  assert.equal(spec.payoutRatioE18, '100000000000000000');
});

test('rejects zero amounts and unsafe payout ratios', () => {
  assert.throws(
    () => parseRuleText('receive 0 ETH and release 10%'),
    /minimum amount/,
  );
  assert.throws(
    () => parseRuleText('receive 1 ETH and release 101%'),
    /at most 100/,
  );
});

test('rejects amounts with more precision than the asset supports', () => {
  assert.throws(
    () => parseRuleText('receive 0.0000001 USDC and release 10%'),
    /more than 6 decimals/,
  );
});
