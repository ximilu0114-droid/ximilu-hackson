import * as fs from 'fs';
import * as path from 'path';

export interface AgentEvent {
  ts: string;
  stage: 'rule-added' | 'match' | 'proved' | 'settled' | 'rejected' | 'delivered';
  tx?: string;
  detail?: string;
}

export interface Rule {
  id: string;
  text: string;
  engine: string;
  active: boolean;
  policyId: number;
  spec: { minAmount: string; token: string | null; payoutRatioE18: string; memo?: string };
  createdAt: string;
}

export interface AgentState {
  lastHeight: number;
  settledTx: Record<string, string>;
  rules: Rule[];
  deliveries: Record<string, string>;
  events: AgentEvent[];
}

const EMPTY: AgentState = { lastHeight: 0, settledTx: {}, rules: [], deliveries: {}, events: [] };

/** agent/state.json lives in the workspace sibling of web/ */
function statePath(): string {
  if (process.env.AGENT_STATE_FILE) {
    return path.resolve(process.env.AGENT_STATE_FILE);
  }
  return path.resolve(process.cwd(), '..', 'agent', 'state.json');
}

export function readState(): AgentState {
  try {
    return {
      ...EMPTY,
      ...JSON.parse(
        fs.readFileSync(/* turbopackIgnore: true */ statePath(), 'utf8'),
      ),
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writeState(s: AgentState): void {
  const target = statePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = target + '.tmp';
  fs.writeFileSync(
    /* turbopackIgnore: true */ temporary,
    JSON.stringify(s, null, 2),
  );
  fs.renameSync(
    /* turbopackIgnore: true */ temporary,
    /* turbopackIgnore: true */ target,
  );
}
