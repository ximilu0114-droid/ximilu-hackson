/**
 * Natural-language rule → structured policy spec.
 *
 * Two engines:
 *  - 'llm': any OpenAI-compatible endpoint (OPENAI_API_KEY + OPENAI_BASE_URL).
 *    Disclosed as third-party service in submission materials.
 *  - 'builtin': deterministic CN/EN parser. Default when no API key — keeps
 *    the demo fully local and repeatable without external dependencies.
 */
export interface PolicySpec {
  sourceChain: 'sepolia';
  token: string | null; // null = native ETH
  payee: string | null; // null = agent wallet
  minAmount: bigint;
  payoutRatioE18: bigint;
  memo: string;
}

export interface ParsedRule {
  engine: 'llm' | 'builtin';
  spec: PolicySpec;
}

const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
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

function decimalToUnits(raw: string, decimals: number): bigint {
  const trimmed = raw.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(trimmed)) {
    throw new Error('invalid decimal amount');
  }
  const normalized = trimmed.replace(/,/g, '');
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) throw new Error(`amount has more than ${decimals} decimals`);
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction || '').padEnd(decimals, '0') || '0')
  );
}

function parseAmount(text: string): { amount: bigint; token: string | null } | null {
  const matches = Array.from(text.matchAll(
    /(?:≥|>=|超过|至少|at least|more than)?\s*([\d,]+(?:\.\d+)?)\s*(USDC|ETH|以太)(?![A-Za-z])/gi,
  ));
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    throw new Error('rule must include exactly one payment amount and asset');
  }
  const m = matches[0];
  const unit = m[2].toUpperCase();
  if (unit === 'USDC') {
    const amount = decimalToUnits(m[1], 6);
    if (amount <= 0n) throw new Error('minimum amount must be greater than 0');
    return { amount, token: USDC };
  }
  const amount = decimalToUnits(m[1], 18);
  if (amount <= 0n) throw new Error('minimum amount must be greater than 0');
  return { amount, token: null };
}

export function builtinParse(text: string, agentWallet: string): PolicySpec {
  if (!hasExplicitSelfReceipt(text)) {
    throw new Error('rule must explicitly describe the agent wallet receiving the payment');
  }
  const amt = parseAmount(text);
  if (!amt) {
    throw new Error('rule must include an explicit positive amount and USDC or ETH');
  }
  if (!hasBoundSepoliaSourceClause(text)) {
    throw new Error('payment amount and self-payee must belong to the Sepolia source clause');
  }
  const minAmount = amt.amount;
  const token = amt.token;

  // explicit release ratio: “按10%释放” / "release 10%" → ratio of received units
  const ratios = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*%/g));
  if (ratios.length === 0) throw new Error('rule must include an explicit payout percentage');
  if (ratios.length !== 1) {
    throw new Error('rule must include exactly one payout percentage');
  }
  const r = ratios[0];
  const payoutRatioE18 = decimalToUnits(r[1], 16);
  if (payoutRatioE18 <= 0n || payoutRatioE18 > MAX_PAYOUT_RATIO_E18) {
    throw new Error('payout percent must be greater than 0 and at most 100');
  }

  const policy = {
    sourceChain: 'sepolia',
    token,
    payee: agentWallet, // “我” = the agent's explicit source-chain address
    minAmount,
    payoutRatioE18,
    memo: text.trim().slice(0, 140),
  };
  assertSafePolicySpec(policy);
  return policy;
}

/** Final local gate for model output and persisted drafts before activation. */
export function assertSafePolicySpec(spec: any): asserts spec is PolicySpec {
  if (spec?.sourceChain !== 'sepolia') throw new Error('unsupported source chain');
  if (spec.token !== null && String(spec.token).toLowerCase() !== USDC.toLowerCase()) {
    throw new Error('unsupported policy asset');
  }
  if (spec.payee !== null && !/^0x[0-9a-fA-F]{40}$/.test(String(spec.payee))) {
    throw new Error('invalid policy payee');
  }
  const parseStoredInteger = (value: unknown, field: string): bigint => {
    if (typeof value === 'bigint') return value;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      throw new Error(`${field} must be an unsigned integer string`);
    }
    return BigInt(value);
  };
  const minAmount = parseStoredInteger(spec.minAmount, 'minimum amount');
  const payoutRatioE18 = parseStoredInteger(spec.payoutRatioE18, 'payout ratio');
  if (minAmount <= 0n) throw new Error('minimum amount must be greater than 0');
  if (payoutRatioE18 <= 0n || payoutRatioE18 > MAX_PAYOUT_RATIO_E18) {
    throw new Error('payout percent must be greater than 0 and at most 100');
  }
}

/** Pure parser used by adversarial tests; malformed model output returns null. */
export function parseLlmPolicyContent(
  content: string,
  text: string,
  agentWallet: string,
  expectedSpec?: PolicySpec,
): PolicySpec | null {
  try {
    const expected = expectedSpec ?? builtinParse(text, agentWallet);
    const normalized = content.trim();
    if (normalized.includes('```')) return null;
    const parsed = JSON.parse(normalized);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return null;
    const keys = Object.keys(parsed).sort();
    const allowedKeys = ['asset', 'minimumAmount', 'payoutPercent'].sort();
    if (
      keys.length !== allowedKeys.length ||
      keys.some((key, index) => key !== allowedKeys[index]) ||
      typeof parsed.asset !== 'string' ||
      typeof parsed.minimumAmount !== 'string' ||
      typeof parsed.payoutPercent !== 'string'
    ) return null;
    const asset = parsed.asset.trim().toUpperCase();
    if (asset !== 'USDC' && asset !== 'ETH') return null;
    const minAmount = decimalToUnits(
      String(parsed.minimumAmount),
      asset === 'ETH' ? 18 : 6,
    );
    const payoutRatioE18 = decimalToUnits(String(parsed.payoutPercent), 16);
    const policy: PolicySpec = {
      sourceChain: 'sepolia',
      token: asset === 'ETH' ? null : USDC,
      payee: agentWallet,
      minAmount,
      payoutRatioE18,
      memo: text.trim().slice(0, 140),
    };
    assertSafePolicySpec(policy);
    if (
      policy.minAmount !== expected.minAmount ||
      policy.payoutRatioE18 !== expected.payoutRatioE18 ||
      (policy.token ?? '').toLowerCase() !== (expected.token ?? '').toLowerCase() ||
      policy.payee?.toLowerCase() !== expected.payee?.toLowerCase()
    ) return null;
    return policy;
  } catch {
    return null;
  }
}

async function llmParse(
  text: string,
  agentWallet: string,
  expected: PolicySpec,
): Promise<PolicySpec | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const base = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'Extract only explicit fields from a cross-chain payment rule. Reply ONLY with JSON: {"asset":"USDC"|"ETH","minimumAmount":"decimal string","payoutPercent":"decimal string"}. Use only USDC or ETH. Never invent or default a money field.',
          },
          { role: 'user', content: text },
        ],
        temperature: 0,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    const content = j.choices?.[0]?.message?.content ?? '';
    return parseLlmPolicyContent(content, text, agentWallet, expected);
  } catch {
    return null;
  }
}

export async function parseRule(text: string, agentWallet: string): Promise<ParsedRule> {
  // Reject incomplete/ambiguous source text before it is sent to any model.
  const deterministic = builtinParse(text, agentWallet);
  const viaLlm = await llmParse(text, agentWallet, deterministic);
  if (viaLlm) return { engine: 'llm', spec: viaLlm };
  return { engine: 'builtin', spec: deterministic };
}
