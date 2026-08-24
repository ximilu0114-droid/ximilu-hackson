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

function parseAmount(text: string): { amount: bigint; token: string | null } | null {
  const m =
    text.match(/(?:≥|>=|超过|至少|at least|more than)?\s*([\d,]+(?:\.\d+)?)\s*(USDC|ETH|以太|美刀|U)/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!isFinite(num) || num <= 0) return null;
  const unit = m[2].toUpperCase();
  if (unit === 'USDC' || unit === 'U' || unit === '美刀') {
    return { amount: BigInt(Math.round(num * 1e6)), token: USDC };
  }
  return { amount: BigInt(Math.round(num * 1e18)), token: null };
}

export function builtinParse(text: string, agentWallet: string): PolicySpec {
  const amt = parseAmount(text);
  const minAmount = amt?.amount ?? 100_000_000n;
  const token = amt?.token ?? USDC;

  // optional release ratio: “按10%释放” / "release 10%" → ratio of received units
  const r = text.match(/(\d+(?:\.\d+)?)\s*%/);
  const pct = r ? parseFloat(r[1]) : 10;

  return {
    sourceChain: 'sepolia',
    token,
    payee: null, // “我” = agent wallet
    minAmount,
    payoutRatioE18: BigInt(Math.round((pct / 100) * 1e18)),
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
              'Extract a cross-chain payment rule from the user message. Reply ONLY with JSON: {"minAmountUsdc": number, "payoutPercent": number}. Defaults: minAmountUsdc=100, payoutPercent=10.',
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
    const usdc = Number(parsed.minAmountUsdc ?? 100);
    const pct = Number(parsed.payoutPercent ?? 10);
    return {
      sourceChain: 'sepolia',
      token: USDC,
      payee: null,
      minAmount: BigInt(Math.round(usdc * 1e6)),
      payoutRatioE18: BigInt(Math.round((pct / 100) * 1e18)),
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
