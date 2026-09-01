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

function decimalToUnits(raw: string, decimals: number): bigint {
  const normalized = raw.replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error('invalid decimal amount');
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) throw new Error(`amount has more than ${decimals} decimals`);
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction || '').padEnd(decimals, '0') || '0')
  );
}

function parseAmount(text: string): { amount: bigint; token: string | null } | null {
  const m =
    text.match(/(?:≥|>=|超过|至少|at least|more than)?\s*([\d,]+(?:\.\d+)?)\s*(USDC|ETH|以太|美刀|U)/i);
  if (!m) return null;
  const unit = m[2].toUpperCase();
  if (unit === 'USDC' || unit === 'U' || unit === '美刀') {
    const amount = decimalToUnits(m[1], 6);
    if (amount <= 0n) throw new Error('minimum amount must be greater than 0');
    return { amount, token: USDC };
  }
  const amount = decimalToUnits(m[1], 18);
  if (amount <= 0n) throw new Error('minimum amount must be greater than 0');
  return { amount, token: null };
}

export function builtinParse(text: string, agentWallet: string): PolicySpec {
  const amt = parseAmount(text);
  const minAmount = amt?.amount ?? 100_000_000n;
  // `null` is intentional for native ETH; only fall back when parsing failed.
  const token = amt ? amt.token : USDC;

  // optional release ratio: “按10%释放” / "release 10%" → ratio of received units
  const r = text.match(/(\d+(?:\.\d+)?)\s*%/);
  const payoutRatioE18 = r ? decimalToUnits(r[1], 16) : 100_000_000_000_000_000n;
  if (payoutRatioE18 <= 0n || payoutRatioE18 > 1_000_000_000_000_000_000n) {
    throw new Error('payout percent must be greater than 0 and at most 100');
  }

  return {
    sourceChain: 'sepolia',
    token,
    payee: agentWallet, // “我” = the agent's explicit source-chain address
    minAmount,
    payoutRatioE18,
    memo: text.trim().slice(0, 140),
  };
}

async function llmParse(text: string, agentWallet: string): Promise<PolicySpec | null> {
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
              'Extract a cross-chain payment rule. Reply ONLY with JSON: {"asset":"USDC"|"ETH","minimumAmount":"decimal string","payoutPercent":"decimal string"}. Use only USDC or ETH. Defaults: USDC, 100, 10.',
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
    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
    const asset = String(parsed.asset ?? 'USDC').toUpperCase();
    if (asset !== 'USDC' && asset !== 'ETH') return null;
    const minAmount = decimalToUnits(
      String(parsed.minimumAmount ?? (asset === 'ETH' ? '0.01' : '100')),
      asset === 'ETH' ? 18 : 6,
    );
    const payoutRatioE18 = decimalToUnits(
      String(parsed.payoutPercent ?? '10'),
      16,
    );
    if (
      minAmount <= 0n ||
      payoutRatioE18 <= 0n ||
      payoutRatioE18 > 1_000_000_000_000_000_000n
    ) {
      return null;
    }
    return {
      sourceChain: 'sepolia',
      token: asset === 'ETH' ? null : USDC,
      payee: agentWallet,
      minAmount,
      payoutRatioE18,
      memo: text.trim().slice(0, 140),
    };
  } catch {
    return null;
  }
}

export async function parseRule(text: string, agentWallet: string): Promise<ParsedRule> {
  const viaLlm = await llmParse(text, agentWallet);
  if (viaLlm) return { engine: 'llm', spec: viaLlm };
  return { engine: 'builtin', spec: builtinParse(text, agentWallet) };
}
