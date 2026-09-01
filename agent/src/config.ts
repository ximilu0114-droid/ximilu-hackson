import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/** Repo root, anchored at this file (immune to npm --prefix cwd changes). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Load repo-root .env FIRST so the CONFIG snapshot below sees real values.
(() => {
  const p = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
})();

export function loadEnvDotenv(): void {
  // kept for backward compat — env is already loaded at module init
}

export const CONFIG = {
  sepoliaRpc: process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com',
  cc3Rpc: process.env.CREDITCOIN_TESTNET_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network',
  proverUrl: process.env.PROVER_URL ?? 'https://prover.cc3-testnet.creditcoin.network',
  privateKey: process.env.AGENT_PRIVATE_KEY ?? '',
  usdcSepolia: process.env.USDC_SEPOLIA ?? '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  ascAddress: process.env.ASC_ADDRESS ?? '',
  inboxAddress: process.env.INBOX_ADDRESS ?? '',
  sepoliaChainKey: 1,
  minUsdcBaseUnits: 100_000_000n,
  scanBlocks: Number(process.env.SCAN_BLOCKS ?? 400),
  nativeScanBlocks: Number(process.env.NATIVE_SCAN_BLOCKS ?? 32),
  recoveryBlockWindow: Number(process.env.RECOVERY_BLOCK_WINDOW ?? 20_000),
  pollMs: Number(process.env.POLL_MS ?? 30_000),
  stateFile: process.env.STATE_FILE ?? path.join(REPO_ROOT, 'agent/state.json'),
  logFile: process.env.LOG_FILE ?? path.join(REPO_ROOT, 'agent/agent.log'),
  liveMode: process.env.LIVE === '1',
};
