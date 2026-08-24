/** Deterministic NL rule parser — mirrors agent/src/llm.ts builtin engine. */
export const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

export interface ParsedSpec {
  minAmount: string;
  token: string | null;
  payoutRatioE18: string;
}

export function parseRuleText(text: string): ParsedSpec {
  const m =
    text.match(/(?:≥|>=|超过|至少|at least|more than)?\s*([\d,]+(?:\.\d+)?)\s*(USDC|ETH|以太|美刀|U)/i);
  let minAmount = '100000000';
  let token: string | null = USDC;
  if (m) {
    const num = parseFloat(m[1].replace(/,/g, ''));
    const unit = m[2].toUpperCase();
    if (unit === 'ETH' || unit === '以太') {
      token = null;
      minAmount = BigInt(Math.round(num * 1e18)).toString();
    } else {
      minAmount = BigInt(Math.round(num * 1e6)).toString();
    }
  }
  const r = text.match(/(\d+(?:\.\d+)?)\s*%/);
  const pct = r ? parseFloat(r[1]) : 10;
  return { minAmount, token, payoutRatioE18: BigInt(Math.round((pct / 100) * 1e18)).toString() };
}
