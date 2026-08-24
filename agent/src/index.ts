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
import { Wallet, Contract } from 'ethers';
import { loadEnvDotenv, CONFIG } from './config.js';
import { loadState, saveState, log, recordEvent, AgentState } from './state.js';
import { parseRule } from './llm.js';
import { makeClients, agentWallet, getProof, settleOnASC, decodeTxBytes, decodeErc20Call } from './prover.js';
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

async function main() {
  loadEnvDotenv();
  const args = argParse();
  const { sepolia, cc3 } = await makeClients();
  const wallet = new Wallet(CONFIG.privateKey || '0x' + '11'.repeat(32));
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
        recordEvent(state, { ts: new Date().toISOString(), stage: 'match', tx: m.txHash, detail: `amount=${m.amount}` });

        // pre-filter: underlying calldata must pay the payee via transfer/transferFrom
        const tx = await sepolia.getTransaction(m.txHash);
        if (!tx || tx.to === null) continue;
        if (tx.to.toLowerCase() !== String((state.rules.find(r => r.id === m.ruleId) as any).spec.token).toLowerCase()) continue;
        const call = decodeErc20Call(tx.data);
        if (!call || call.recipient.toLowerCase() !== m.payee.toLowerCase()) continue;

        log(`match: rule=${m.ruleId} tx=${m.txHash} amount=${m.amount}`);

        // proof generation (waits only because we scan the attested window)
        const proof = await getProof(m.txHash);
        recordEvent(state, { ts: new Date().toISOString(), stage: 'proved', tx: m.txHash, detail: `block=${proof.headerNumber} idx=${proof.txIndex}` });

        // on-chain settle (live) or local decode validation (dry)
        const res = await settleOnASC(0, proof);
        if (res.rejected) {
          state.settledTx[m.txHash] = 'rejected:status!=1';
          recordEvent(state, { ts: new Date().toISOString(), stage: 'rejected', tx: m.txHash, detail: 'status!=1' });
          continue;
        }
        if (!res.dry && !res.txHash) continue;
        state.settledTx[m.txHash] = res.dry ? `dry@${new Date().toISOString()}` : res.txHash;
        recordEvent(state, { ts: new Date().toISOString(), stage: 'settled', tx: m.txHash, detail: res.dry ? 'dry-run' : res.txHash });

        // writability leg: payload mirrors ASC MessagePublished encoding
        const tv = decodeTxBytes(proof.txBytes);
        const released = (m.amount * BigInt((state.rules.find((r) => r.id === m.ruleId) as any).spec.payoutRatioE18)) / 10n ** 6n;
        void tv;
        const payload = (
          await import('ethers')
        ).AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'bytes32', 'uint256', 'uint256'],
          [0, ('0x' + '0'.repeat(64)).slice(0, 66), m.amount, released],
        );
        const delivery = await deliverMessage(payload, wallet as Wallet, inbox);
        state.deliveries[m.txHash] = delivery.dry ? `dry-sig` : delivery.txHash;
        recordEvent(state, { ts: new Date().toISOString(), stage: 'delivered', tx: m.txHash, detail: delivery.dry ? 'dry-sig' : delivery.txHash });
        log(`settled+delivered: ${m.txHash} release≈${released}`);
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
