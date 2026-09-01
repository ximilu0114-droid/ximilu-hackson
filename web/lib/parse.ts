/** Deterministic NL rule parser — mirrors agent/src/llm.ts builtin engine. */
export const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

export interface ParsedSpec {
  minAmount: string;
  token: string | null;
  payoutRatioE18: string;
}

export function decimalToUnits(raw: string, decimals: number): bigint {
  const normalized = raw.replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error('invalid decimal amount');
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) {
    throw new Error(`amount has more than ${decimals} decimals`);
  }
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction || '').padEnd(decimals, '0') || '0')
  );
}

export function parseRuleText(text: string): ParsedSpec {
  const amountMatch = text.match(
    /(?:≥|>=|超过|至少|at least|more than)?\s*([\d,]+(?:\.\d+)?)\s*(USDC|ETH|以太|美刀|U)/i,
  );

  let minAmount = 100_000_000n;
  let token: string | null = USDC;
  if (amountMatch) {
    const unit = amountMatch[2].toUpperCase();
    const native = unit === 'ETH' || unit === '以太';
    token = native ? null : USDC;
    minAmount = decimalToUnits(amountMatch[1], native ? 18 : 6);
    if (minAmount <= 0n) throw new Error('minimum amount must be greater than 0');
  }

  const ratioMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  const payoutRatioE18 = ratioMatch
    ? decimalToUnits(ratioMatch[1], 16)
    : 100_000_000_000_000_000n;
  if (payoutRatioE18 <= 0n || payoutRatioE18 > 1_000_000_000_000_000_000n) {
    throw new Error('payout percent must be greater than 0 and at most 100');
  }

  return {
    minAmount: minAmount.toString(),
    token,
    payoutRatioE18: payoutRatioE18.toString(),
  };
}
