/**
 * AttestFlow Agent — autonomous cross-chain settlement loop.
 *
 *   parse rule (NL) → watch attested window → generate proof → verify+settle
 *   → publish writability message → deliver to destination inbox
 *
 * Crash-safe: cursor + dedupe state persisted to agent/state.json after each
 * pass; restart resumes from the last scanned height without losing events.
 *
 * Usage:
 *   npm --prefix agent run start -- --rule "当我在Sepolia收到≥100 USDC时按10%释放" [--once]
 */
import { Wallet, Contract, parseEther } from 'ethers';
import { loadEnvDotenv, CONFIG } from './config.js';
import { loadState, saveState, log, recordEvent, AgentState } from './state.js';
import { parseRule } from './llm.js';
import { makeClients, agentWallet, getProof, settleOnASC, decodeTxBytes, decodeErc20Call, ensurePolicy, ASC_ABI } from './prover.js';
import { scanOnce } from './watcher.js';
import { deliverMessage, INBOX_ABI } from './relayer.js';

interface Args {
  rule?: string;
  once: boolean;
}

function argParse(): Args {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--rule');
  return {
    rule: i >= 0 ? argv[i + 1] : undefined,
    once: argv.includes('--once'),
  };
}

interface MatchResult {
  txHash: string;
  ruleId: string;
  payee: string;
  amount: bigint;
}

/** Full pipeline for one matched payment: prefilter → proof → settle → deliver. */
async function processMatch(
  m: MatchResult,
  state: AgentState,
  sepolia: any,
  asc: Contract | null,
  inbox: Contract | null,
  wallet: Wallet
): Promise<void> {
  const rule = state.rules.find((r) => r.id === m.ruleId)!;
  const spec: any = rule.spec;
  recordEvent(state, { ts: new Date().toISOString(), stage: 'match', tx: m.txHash, detail: `amount=${m.amount}` });

  // pre-filter: underlying calldata must pay the payee via transfer/transferFrom
  const tx = await sepolia.getTransaction(m.txHash);
  if (!tx || tx.to === null) return;
  if (spec.token && tx.to.toLowerCase() !== String(spec.token).toLowerCase()) return;
  const call = decodeErc20Call(tx.data);
  if (spec.token && (!call || call.recipient.toLowerCase() !== m.payee.toLowerCase())) return;

  log(`match: rule=${m.ruleId} tx=${m.txHash} amount=${m.amount}`);

  // proof generation (waits only because we scan the attested window)
  const proof = await getProof(m.txHash);
  recordEvent(state, { ts: new Date().toISOString(), stage: 'proved', tx: m.txHash, detail: `block=${proof.headerNumber} idx=${proof.txIndex}` });

  // LIVE: find-or-create the ASC policy for this payee
  let policyId = 0;
  if (asc) {
    policyId = await ensurePolicy(asc, wallet.address, spec, m.payee);
  }

  // on-chain settle (live) or local decode validation (dry)
  const res = await settleOnASC(asc, policyId, proof);
  if (res.rejected) {
    state.settledTx[m.txHash] = 'rejected:status!=1';
    recordEvent(state, { ts: new Date().toISOString(), stage: 'rejected', tx: m.txHash, detail: 'status!=1' });
    return;
  }
  if (!res.dry && !res.txHash) return;
  state.settledTx[m.txHash] = res.dry ? `dry@${new Date().toISOString()}` : res.txHash;
  recordEvent(state, { ts: new Date().toISOString(), stage: 'settled', tx: m.txHash, detail: res.dry ? 'dry-run' : res.txHash });

  // writability leg: payload mirrors ASC MessagePublished encoding
  const decimals = spec.token ? 6n : 18n;
  const released = (m.amount * BigInt(spec.payoutRatioE18)) / 10n ** decimals;
  const payload = (
    await import('ethers')
  ).AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'uint256', 'uint256'],
    [policyId, ('0x' + '0'.repeat(64)).slice(0, 66), m.amount, released],
  );
  const delivery = await deliverMessage(payload, wallet, inbox);
  state.deliveries[m.txHash] = delivery.dry ? `dry-sig` : delivery.txHash;
  recordEvent(state, { ts: new Date().toISOString(), stage: 'delivered', tx: m.txHash, detail: delivery.dry ? 'dry-sig' : delivery.txHash });
  log(`settled+delivered: ${m.txHash} release≈${released}`);
}

async function main() {
  loadEnvDotenv();
  const args = argParse();
  const { sepolia, cc3 } = await makeClients();
  const wallet = new Wallet(CONFIG.privateKey || '0x' + '11'.repeat(32), sepolia);
  const state: AgentState = loadState();

  log(`agent start (live=${CONFIG.liveMode}) wallet=${wallet.address} lastHeight=${state.lastHeight}`);

  // [1] Register the natural-language rule
  if (args.rule) {
    if (!state.rules.find((r) => r.text === args.rule)) {
      const parsed = await parseRule(args.rule!, wallet.address);
      const id = 'r' + (state.rules.length + 1);
      state.rules.push({ id, text: args.rule!, engine: parsed.engine, active: true, policyId: 0, spec: parsed.spec as any, createdAt: new Date().toISOString() });
      recordEvent(state, { ts: new Date().toISOString(), stage: 'rule-added', detail: `${id}: ${args.rule}` });
      log(`rule ${id} registered via ${parsed.engine}: min=${parsed.spec.minAmount} token=${parsed.spec.token} ratio=${parsed.spec.payoutRatioE18}`);
    }
  }
  if (state.rules.length === 0) {
    log('no rules registered; pass --rule "..." — exiting');
    saveState(state);
    return;
  }

  const inbox =
    CONFIG.liveMode && CONFIG.inboxAddress
      ? new Contract(CONFIG.inboxAddress, INBOX_ABI, agentWallet(sepolia))
      : null;

  // LIVE: attach to deployed ASC with a funded signer; DRY: asc stays null.
  const asc =
    CONFIG.liveMode && CONFIG.ascAddress
      ? new Contract(CONFIG.ascAddress, ASC_ABI, agentWallet(cc3))
      : null;

  // LIVE: pre-fund escrow so policy payouts (ratio × matched amount) never bounce
  if (asc) {
    const target = parseEther('500');
    const cur: bigint = await asc.escrowBalance();
    if (cur < target) {
      await (await agentWallet(cc3).sendTransaction({ to: CONFIG.ascAddress, value: target - cur })).wait();
      log(`escrow topped up to 500 CTC (was ${cur})`);
    }
  }

  // [2] Autonomous loop with crash recovery
  let running = true;
  process.on('SIGINT', () => {
    log('SIGINT — checkpointing and exiting');
    running = false;
  });

  while (running) {
    try {
      const matches = await scanOnce(sepolia, state, state.rules.filter((r) => r.active) as any, wallet.address);

      for (const m of matches) {
        if (state.settledTx[m.txHash]) continue; // dedupe across restarts
        try {
          await processMatch(m, state, sepolia, asc, inbox, wallet);
        } catch (e: any) {
          // isolate per-tx failures (e.g. ALREADY_SETTLED on historical matches)
          const msg = String(e?.message ?? e).slice(0, 160);
          log(`match ${m.txHash} failed: ${msg}`);
          state.settledTx[m.txHash] = 'error:' + msg.slice(0, 60);
          recordEvent(state, { ts: new Date().toISOString(), stage: 'rejected', tx: m.txHash, detail: msg });
        }
      }

      saveState(state); // checkpoint after every pass
    } catch (e: any) {
      log(`loop error: ${e.message?.slice(0, 200)}`);
    }

    if (args.once) break;
    await new Promise((r) => setTimeout(r, CONFIG.pollMs));
  }

  saveState(state);
  log('agent stopped');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
