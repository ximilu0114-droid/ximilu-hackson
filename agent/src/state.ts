import * as fs from 'fs';
import * as path from 'path';
import { CONFIG } from './config.js';

export interface AgentState {
  lastHeight: number; // last Sepolia block scanned
  settledTx: Record<string, string>; // txHash -> settlement info
  rules: Array<{ id: string; text: string; engine: string; spec: any; createdAt: string }>;
  deliveries: Record<string, string>; // MessagePublished key -> delivery tx
}

const EMPTY: AgentState = { lastHeight: 0, settledTx: {}, rules: [], deliveries: {} };

export function loadState(): AgentState {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf8')) };
  } catch {
    return { ...EMPTY };
  }
}

export function saveState(s: AgentState): void {
  fs.mkdirSync(path.dirname(CONFIG.stateFile), { recursive: true });
  const tmp = CONFIG.stateFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  fs.renameSync(tmp, CONFIG.stateFile);
}

export function log(line: string): void {
  const ts = new Date().toISOString();
  const out = `[${ts}] ${line}`;
  console.log(out);
  fs.mkdirSync(path.dirname(CONFIG.logFile), { recursive: true });
  fs.appendFileSync(CONFIG.logFile, out + '\n');
}
