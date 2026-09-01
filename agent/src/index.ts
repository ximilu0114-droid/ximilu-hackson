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
 *   npm --prefix agent run start -- --activate r1 [--once]  # approve an LLM draft
 */
import { Wallet, Contract, parseEther, AbiCoder, getAddress } from 'ethers';
import { loadEnvDotenv, CONFIG } from './config.js';
import { loadState, saveState, log, recordEvent, AgentState } from './state.js';
import { assertSafePolicySpec, parseRule } from './llm.js';
import { makeClients, assertSepoliaRegistry, agentWallet, getProof, preflightBatchProof, settleOnASC, decodeTxBytes, decodeErc20Call, ensurePolicy, ASC_ABI } from './prover.js';
import { scanOnce } from './watcher.js';
import { deliverMessage, INBOX_ABI } from './relayer.js';

interface Args {
  rule?: string;
  activateRule?: string;
  sourceTx?: string;
  once: boolean;
}

function argParse(): Args {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--rule');
  const activateArg = argv.indexOf('--activate');
  const txArg = argv.indexOf('--tx');
  return {
    rule: i >= 0 ? argv[i + 1] : undefined,
    activateRule: activateArg >= 0 ? argv[activateArg + 1] : undefined,
    sourceTx: txArg >= 0 ? argv[txArg + 1] : undefined,
    once: argv.includes('--once'),
  };
}

interface MatchResult {
  txHash: string;
  ruleId: string;
  payee: string;
  amount: bigint;
}

/** Deterministically match one known, already-attested source transaction. */
async function matchKnownTransaction(
  txHash: string,
  rule: AgentState['rules'][number],
  sepolia: any,
  agentAddress: string,
): Promise<MatchResult> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('INVALID_TX_HASH');
  const tx = await sepolia.getTransaction(txHash);
  if (!tx || !tx.to) throw new Error('SOURCE_TX_NOT_FOUND_OR_CREATION');
  const payee = getAddress(rule.spec.payee ?? agentAddress);
  let amount: bigint;
  if (rule.spec.token) {
    if (tx.to.toLowerCase() !== String(rule.spec.token).toLowerCase()) {
      throw new Error('SOURCE_TX_TOKEN_MISMATCH');
    }
    const call = decodeErc20Call(tx.data);
    if (!call || getAddress(call.recipient) !== payee) {
      throw new Error('SOURCE_TX_PAYEE_MISMATCH');
    }
    amount = call.amount;
  } else {
    if (getAddress(tx.to) !== payee) throw new Error('SOURCE_TX_PAYEE_MISMATCH');
    amount = tx.value;
  }
  if (amount < BigInt(rule.spec.minAmount)) throw new Error('SOURCE_TX_AMOUNT_TOO_LOW');
  return { txHash, ruleId: rule.id, payee, amount };
}

/** Full pipeline for one matched payment: prefilter → proof → settle → deliver. */
async function processMatch(
  m: MatchResult,
  state: AgentState,
  sepolia: any,
  cc3: any,
  asc: Contract | null,
  inbox: Contract | null,
  wallet: Wallet
): Promise<void> {
  const rule = state.rules.find((r) => r.id === m.ruleId)!;
  const spec: any = rule.spec;

  // pre-filter: underlying calldata must pay the payee via transfer/transferFrom
  const tx = await sepolia.getTransaction(m.txHash);
  if (!tx || tx.to === null) throw new Error('MATCH_TX_MISSING_OR_CREATION');
  if (spec.token && tx.to.toLowerCase() !== String(spec.token).toLowerCase()) {
    throw new Error('MATCH_TOKEN_MISMATCH');
  }
  const call = decodeErc20Call(tx.data);
  if (spec.token && (!call || call.recipient.toLowerCase() !== m.payee.toLowerCase())) {
    throw new Error('MATCH_CALLDATA_RECIPIENT_MISMATCH');
  }
  if (spec.token && call!.amount !== m.amount) {
    throw new Error('MATCH_EVENT_CALLDATA_AMOUNT_MISMATCH');
  }
  if (!spec.token && (tx.to.toLowerCase() !== m.payee.toLowerCase() || tx.value !== m.amount)) {
    throw new Error('MATCH_NATIVE_PAYMENT_MISMATCH');
  }
  const matchedAmount = spec.token ? call!.amount : m.amount;

  recordEvent(state, {
    ts: new Date().toISOString(),
    stage: 'match',
    tx: m.txHash,
    detail: `amount=${matchedAmount}`,
  });

  log(`match: rule=${m.ruleId} tx=${m.txHash} amount=${matchedAmount}`);

  // LIVE: pre-flight escrow solvency — top up before attempting settlement
  if (asc) {
    const decimals = spec.token ? 6n : 18n;
    const released = (matchedAmount * BigInt(spec.payoutRatioE18)) / 10n ** decimals;
    const esc: bigint = await asc.escrowBalance();
    if (esc < released) {
      const topUp = released * 2n - esc;
      await (await agentWallet(cc3).sendTransaction({ to: CONFIG.ascAddress, value: topUp })).wait();
      log(`escrow topped up by ${Number(topUp) / 1e18} CTC for this settlement`);
    }
  }

  // proof generation (waits only because we scan the attested window)
  const proof = await getProof(m.txHash);
  recordEvent(state, { ts: new Date().toISOString(), stage: 'proved', tx: m.txHash, detail: `block=${proof.headerNumber} idx=${proof.txIndex}` });

  // LIVE: find-or-create the ASC policy for this payee
  let policyId = 0;
  if (asc) {
    policyId = await ensurePolicy(
      asc,
      wallet.address,
      spec,
      m.payee,
      CONFIG.inboxAddress,
    );
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
  saveState(state); // checkpoint the irreversible CC3 side before destination I/O

  // writability leg: payload mirrors ASC MessagePublished encoding
  const decimals = spec.token ? 6n : 18n;
  const released = (matchedAmount * BigInt(spec.payoutRatioE18)) / 10n ** decimals;
  const payload =
    res.messagePayload ??
    AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'bytes32', 'uint256', 'uint256'],
      [policyId, res.sourceTxId, matchedAmount, released],
    );
  const [payloadPolicyId, payloadSourceTxId, payloadAmount, payloadReleased] =
    AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'bytes32', 'uint256', 'uint256'],
      payload,
    );
  if (
    payloadPolicyId !== BigInt(policyId) ||
    String(payloadSourceTxId).toLowerCase() !== res.sourceTxId.toLowerCase() ||
    payloadAmount !== matchedAmount ||
    payloadReleased !== released
  ) {
    throw new Error('MESSAGE_PAYLOAD_DOES_NOT_MATCH_SETTLEMENT');
  }
  const delivery = await deliverMessage(payload, wallet, inbox);
  state.deliveries[m.txHash] = delivery.dry ? `dry-sig` : delivery.txHash;
  recordEvent(state, { ts: new Date().toISOString(), stage: 'delivered', tx: m.txHash, detail: delivery.dry ? 'dry-sig' : delivery.txHash });
  saveState(state);
  log(`settled+delivered: ${m.txHash} release≈${released}`);
}

async function main() {
  loadEnvDotenv();
  const args = argParse();
  if (
    CONFIG.liveMode &&
    (!CONFIG.privateKey || !CONFIG.ascAddress || !CONFIG.inboxAddress)
  ) {
    throw new Error(
      'LIVE=1 requires AGENT_PRIVATE_KEY, ASC_ADDRESS and INBOX_ADDRESS',
    );
  }
  const { sepolia, cc3 } = await makeClients();
  await assertSepoliaRegistry(cc3);
  const wallet = new Wallet(CONFIG.privateKey || '0x' + '11'.repeat(32), sepolia);
  const state: AgentState = loadState();

  log(`agent start (live=${CONFIG.liveMode}) wallet=${wallet.address} lastHeight=${state.lastHeight}`);

  // [1] Register the natural-language rule
  if (args.rule) {
    if (!state.rules.find((r) => r.text === args.rule)) {
      const parsed = await parseRule(args.rule!, wallet.address);
      const id = 'r' + (state.rules.length + 1);
      // The CLI invocation itself approves exact deterministic compilation.
      // Model-assisted output remains a draft until a later --activate call.
      const active = parsed.engine === 'builtin';
      state.rules.push({ id, text: args.rule!, engine: parsed.engine, active, policyId: 0, spec: parsed.spec as any, createdAt: new Date().toISOString() });
      recordEvent(state, { ts: new Date().toISOString(), stage: 'rule-added', detail: `${id} ${active ? 'active' : 'draft'} via ${parsed.engine}: ${args.rule}` });
      log(`rule ${id} compiled via ${parsed.engine}: asset=${parsed.spec.token ? 'USDC' : 'ETH'} min=${parsed.spec.minAmount} ratio=${parsed.spec.payoutRatioE18} status=${active ? 'active' : 'REVIEW_REQUIRED'}`);
      if (!active) log(`review the compiled fields, then rerun with --activate ${id}`);
    }
  }
  if (args.activateRule) {
    const rule = state.rules.find((candidate) => candidate.id === args.activateRule);
    if (!rule) throw new Error(`RULE_NOT_FOUND:${args.activateRule}`);
    assertSafePolicySpec(rule.spec);
    rule.active = true;
    recordEvent(state, {
      ts: new Date().toISOString(),
      stage: 'rule-activated',
      detail: `${rule.id}: ${rule.text}`,
    });
    log(`rule ${rule.id} explicitly activated after review`);
  }
  if (state.rules.length === 0) {
    log('no rules registered; pass --rule "..." — exiting');
    saveState(state);
    return;
  }
  if (!state.rules.some((rule) => rule.active)) {
    log('no active rules; review a compiled draft and pass --activate <rule-id> — exiting');
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

  // Deterministic demo/recovery path: process one known attested payment.
  // It still fetches the real source tx, builds the real proof and executes the
  // same processMatch pipeline; only discovery-by-scanning is bypassed.
  if (args.sourceTx) {
    if (state.settledTx[args.sourceTx] && state.deliveries[args.sourceTx]) {
      log(`source tx already processed: ${args.sourceTx}`);
    } else {
      const activeRule = state.rules.find((r) => r.active);
      if (!activeRule) throw new Error('NO_ACTIVE_RULE');
      const match = await matchKnownTransaction(
        args.sourceTx,
        activeRule,
        sepolia,
        wallet.address,
      );
      await processMatch(match, state, sepolia, cc3, asc, inbox, wallet);
    }
    saveState(state);
    log('agent stopped');
    return;
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

      const pending = matches.filter(
        (match) => !(state.settledTx[match.txHash] && state.deliveries[match.txHash]),
      );
      // Multi-payment catch-up is fail-closed at the protocol layer: each
      // 2-10 item chunk must pass one native batch verification before any
      // member is settled. A thrown preflight leaves the cursor unsaved so the
      // complete window is retried on the next loop.
      for (let offset = 0; offset < pending.length; offset += 10) {
        const batch = pending.slice(offset, offset + 10);
        if (batch.length >= 2) {
          await preflightBatchProof(
            batch.map((match) => match.txHash),
            cc3,
          );
        }
      }

      for (const m of pending) {
        try {
          await processMatch(m, state, sepolia, cc3, asc, inbox, wallet);
        } catch (e: any) {
          // isolate per-tx failures (e.g. ALREADY_SETTLED on historical matches)
          const msg = String(e?.message ?? e).slice(0, 160);
          log(`match ${m.txHash} failed: ${msg}`);
          const already = msg.includes('ALREADY_SETTLED');
          if (!/^0x[0-9a-fA-F]{64}$/.test(state.settledTx[m.txHash] ?? '')) {
            state.settledTx[m.txHash] = already ? 'already-settled' : 'error:' + msg.slice(0, 60);
          }
          recordEvent(state, {
            ts: new Date().toISOString(),
            stage: already ? 'settled' : 'rejected',
            tx: m.txHash,
            detail: already ? 'already settled on-chain (replay guard)' : msg,
          });
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
