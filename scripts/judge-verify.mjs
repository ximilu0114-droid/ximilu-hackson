#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const steps = [
  {
    id: "ci",
    label: "typecheck, 32 tests, production build, and production audit",
    args: ["run", "ci"],
  },
  {
    id: "live-evidence",
    label: "62 public cross-chain evidence checks",
    args: ["run", "verify:evidence"],
  },
  {
    id: "fresh-proof",
    label: "fresh Attestcoin proof and read-only CC3 verification",
    args: ["run", "e2e:proof"],
  },
];

const runStarted = performance.now();
const results = [];
let exitCode = 0;

for (const [index, step] of steps.entries()) {
  process.stdout.write(
    `\n=== judge:verify ${index + 1}/${steps.length} · ${step.label} ===\n\n`,
  );

  const stepStarted = performance.now();
  const result = spawnSync(npmCommand, step.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  const elapsedSeconds = Number(((performance.now() - stepStarted) / 1000).toFixed(2));
  const succeeded = !result.error && result.status === 0;

  results.push({
    step: step.id,
    status: succeeded ? "SUCCESS" : "FAILED",
    elapsedSeconds,
  });

  if (!succeeded) {
    if (result.error) {
      process.stderr.write(`judge:verify could not start ${step.id}: ${result.error.message}\n`);
    }
    exitCode = result.status ?? 1;
    break;
  }
}

const commitResult = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
  cwd: process.cwd(),
  encoding: "utf8",
});
const commit = commitResult.status === 0 ? commitResult.stdout.trim() : "unknown";

process.stdout.write(
  `\n${JSON.stringify(
    {
      step: "judge-verify",
      status: exitCode === 0 ? "SUCCESS" : "FAILED",
      commit,
      node: process.version,
      elapsedSeconds: Number(((performance.now() - runStarted) / 1000).toFixed(2)),
      results,
    },
    null,
    2,
  )}\n`,
);

process.exitCode = exitCode;
