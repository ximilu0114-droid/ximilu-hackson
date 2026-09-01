/** Deterministic NL rule parser — mirrors agent/src/llm.ts builtin engine. */
export const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

export interface ParsedSpec {
  minAmount: string;
  token: string | null;
  payoutRatioE18: string;
}

const MAX_PAYOUT_RATIO_E18 = 1_000_000_000_000_000_000n;
const AMOUNT_ASSET_PATTERN = String.raw`(?:≥|>=|超过|至少|at least|more than)?\s*[\d,]+(?:\.\d+)?\s*(?:USDC|ETH|以太)(?![A-Za-z])`;

function hasExplicitSelfReceipt(text: string): boolean {
  return (
    /\bI\s+(?:receive|received|get|got)\b/i.test(text) ||
    /\bmy\s+(?:Sepolia\s+)?(?:wallet|address)\s+(?:receives?|received|gets?|got)\b/i.test(text) ||
    /我\s*(?:在\s*Sepolia\s*)?(?:收到|接收|获得)/i.test(text)
  );
}

function hasBoundSepoliaSourceClause(text: string): boolean {
  const englishSelf = String.raw`(?:\bI\s+(?:receive|received|get|got)\b|\bmy\s+(?:wallet|address)\s+(?:receives?|received|gets?|got)\b)`;
  const patterns = [
    new RegExp(String.raw`${englishSelf}[^.!?\n]{0,100}${AMOUNT_ASSET_PATTERN}\s+(?:on|in)\s+(?:Ethereum\s+)?Sepolia\b`, 'i'),
    new RegExp(String.raw`\b(?:on|in)\s+(?:Ethereum\s+)?Sepolia\b[^.!?\n]{0,60}${englishSelf}[^.!?\n]{0,100}${AMOUNT_ASSET_PATTERN}`, 'i'),
    new RegExp(String.raw`\bmy\s+(?:Ethereum\s+)?Sepolia\s+(?:wallet|address)\s+(?:receives?|received|gets?|got)\b[^.!?\n]{0,100}${AMOUNT_ASSET_PATTERN}`, 'i'),
    new RegExp(String.raw`我\s*在\s*Sepolia\s*(?:收到|接收|获得)[^。！？\n]{0,100}${AMOUNT_ASSET_PATTERN}`, 'i'),
    new RegExp(String.raw`在\s*Sepolia[^。！？\n]{0,40}我\s*(?:收到|接收|获得)[^。！？\n]{0,100}${AMOUNT_ASSET_PATTERN}`, 'i'),
  ];
  return patterns.some((pattern) => pattern.test(text));
}

export function decimalToUnits(raw: string, decimals: number): bigint {
  const trimmed = raw.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(trimmed)) {
    throw new Error('invalid decimal amount');
  }
  const normalized = trimmed.replace(/,/g, '');
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
  if (!hasExplicitSelfReceipt(text)) {
    throw new Error('rule must explicitly describe the agent wallet receiving the payment');
  }
  const amountMatches = Array.from(text.matchAll(
    /(?:≥|>=|超过|至少|at least|more than)?\s*([\d,]+(?:\.\d+)?)\s*(USDC|ETH|以太)(?![A-Za-z])/gi,
  ));
  if (amountMatches.length === 0) {
    throw new Error('rule must include an explicit positive amount and USDC or ETH');
  }
  if (amountMatches.length !== 1) {
    throw new Error('rule must include exactly one payment amount and asset');
  }
  if (!hasBoundSepoliaSourceClause(text)) {
    throw new Error('payment amount and self-payee must belong to the Sepolia source clause');
  }
  const amountMatch = amountMatches[0];
  const unit = amountMatch[2].toUpperCase();
  const native = unit === 'ETH' || unit === '以太';
  const token: string | null = native ? null : USDC;
  const minAmount = decimalToUnits(amountMatch[1], native ? 18 : 6);
  if (minAmount <= 0n) throw new Error('minimum amount must be greater than 0');

  const ratioMatches = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*%/g));
  if (ratioMatches.length === 0) {
    throw new Error('rule must include an explicit payout percentage');
  }
  if (ratioMatches.length !== 1) {
    throw new Error('rule must include exactly one payout percentage');
  }
  const ratioMatch = ratioMatches[0];
  const payoutRatioE18 = decimalToUnits(ratioMatch[1], 16);
  if (payoutRatioE18 <= 0n || payoutRatioE18 > MAX_PAYOUT_RATIO_E18) {
    throw new Error('payout percent must be greater than 0 and at most 100');
  }

  return validateParsedSpec({
    minAmount: minAmount.toString(),
    token,
    payoutRatioE18: payoutRatioE18.toString(),
  });
}

/** Re-check persisted or model-produced policy fields before activation. */
export function validateParsedSpec(spec: ParsedSpec): ParsedSpec {
  if (
    spec?.token !== null &&
    (typeof spec?.token !== 'string' || spec.token.toLowerCase() !== USDC.toLowerCase())
  ) {
    throw new Error('unsupported policy asset');
  }
  if (!/^\d+$/.test(String(spec.minAmount)) || !/^\d+$/.test(String(spec.payoutRatioE18))) {
    throw new Error('policy values must be unsigned integer strings');
  }
  const minAmount = BigInt(spec.minAmount);
  const payoutRatioE18 = BigInt(spec.payoutRatioE18);
  if (minAmount <= 0n) throw new Error('minimum amount must be greater than 0');
  if (payoutRatioE18 <= 0n || payoutRatioE18 > MAX_PAYOUT_RATIO_E18) {
    throw new Error('payout percent must be greater than 0 and at most 100');
  }
  return {
    minAmount: minAmount.toString(),
    token: spec.token === null ? null : USDC,
    payoutRatioE18: payoutRatioE18.toString(),
  };
}
