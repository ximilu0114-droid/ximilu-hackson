#!/usr/bin/env node

/**
 * Publish and verify the two deployed contracts through Sourcify API v2.
 *
 * Hardhat 2.26's verification plugin still calls Sourcify API v1, which was
 * retired on 2026-07-07. This script submits the exact Hardhat standard JSON
 * compiler input and then treats the v2 contract lookup as the success gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SOURCIFY_SERVER = process.env.SOURCIFY_SERVER ?? 'https://sourcify.dev/server';
const POLL_INTERVAL_MS = 2_000;
const POLL_ATTEMPTS = 45;

const targets = [
  {
    id: 'cc3-asc',
    chainId: '102031',
    address: '0x4E7410Ebf41C213378E1D8aA4423323303086bF6',
    creationTransactionHash:
      '0x782d27be9fbb2ba515d77e0e6f4987f3810eb297cd4f189ec72b08cb7ffca6c6',
    contractIdentifier: 'contracts/AttestFlowASC.sol:AttestFlowASC',
    artifactDebug:
      'contracts/artifacts/contracts/AttestFlowASC.sol/AttestFlowASC.dbg.json',
  },
  {
    id: 'sepolia-inbox',
    chainId: '11155111',
    address: '0x83A0b8D26Dd28094eE0CA74E57e79028194f868E',
    creationTransactionHash:
      '0x482c72ca1da3368ee35bdcc30dfbf8ff48c6803fc30772f6cba8b47c1bd596d1',
    contractIdentifier: 'contracts/InboxDemo.sol:InboxDemo',
    artifactDebug:
      'contracts/artifacts/contracts/InboxDemo.sol/InboxDemo.dbg.json',
  },
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `Sourcify returned non-JSON HTTP ${response.status}: ${text.slice(0, 160)}`,
    );
  }
  return { status: response.status, ok: response.ok, body };
}

async function lookup(target, fields = '') {
  const suffix = fields ? `?fields=${encodeURIComponent(fields)}` : '';
  return requestJson(
    `${SOURCIFY_SERVER}/v2/contract/${target.chainId}/${target.address}${suffix}`,
  );
}

function isExactMatch(body) {
  return (
    body?.match === 'exact_match' &&
    body?.creationMatch === 'exact_match' &&
    body?.runtimeMatch === 'exact_match'
  );
}

async function verifyTarget(target) {
  const existing = await lookup(target);
  if (existing.ok && isExactMatch(existing.body)) {
    return { target: target.id, ...existing.body, alreadyVerified: true };
  }

  const debugPath = path.resolve(process.cwd(), target.artifactDebug);
  if (!fs.existsSync(debugPath)) {
    const compile = spawnSync('npm', ['--prefix', 'contracts', 'run', 'compile'], {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
    if (compile.status !== 0 || !fs.existsSync(debugPath)) {
      throw new Error(`Could not compile artifact for ${target.contractIdentifier}`);
    }
  }
  const debugInfo = JSON.parse(fs.readFileSync(debugPath, 'utf8'));
  const buildInfoPath = path.resolve(path.dirname(debugPath), debugInfo.buildInfo);
  const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
  const submission = await requestJson(
    `${SOURCIFY_SERVER}/v2/verify/${target.chainId}/${target.address}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stdJsonInput: buildInfo.input,
        compilerVersion: buildInfo.solcLongVersion,
        contractIdentifier: target.contractIdentifier,
        creationTransactionHash: target.creationTransactionHash,
      }),
    },
  );
  if (!submission.ok || !submission.body.verificationId) {
    throw new Error(
      `Sourcify rejected ${target.id}: ${JSON.stringify(submission.body)}`,
    );
  }
  const verificationId = submission.body.verificationId;
  console.log(`[${target.id}] submitted verification job ${verificationId}`);

  let lastJob = null;
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt++) {
    await wait(POLL_INTERVAL_MS);
    const [contract, job] = await Promise.all([
      lookup(target),
      requestJson(`${SOURCIFY_SERVER}/v2/verify/${verificationId}`),
    ]);
    lastJob = job.body;
    if (contract.ok && isExactMatch(contract.body)) {
      return {
        target: target.id,
        ...contract.body,
        verificationId,
        alreadyVerified: false,
      };
    }
    if (attempt % 5 === 0) {
      console.log(`[${target.id}] waiting for exact compiler match (${attempt * 2}s)`);
    }
  }
  throw new Error(
    `Sourcify job ${verificationId} did not produce a match: ${JSON.stringify(lastJob)}`,
  );
}

async function main() {
  const requested = process.env.SOURCIFY_TARGET ?? 'all';
  const selected =
    requested === 'all' ? targets : targets.filter((target) => target.id === requested);
  if (selected.length === 0) {
    throw new Error(`Unknown SOURCIFY_TARGET=${requested}`);
  }

  const results = [];
  for (const target of selected) {
    results.push(await verifyTarget(target));
  }
  console.log(
    JSON.stringify(
      {
        step: 'verify-sourcify-v2',
        status: 'SUCCESS',
        contracts: results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('SOURCIFY VERIFICATION FAILED:', error);
  process.exit(1);
});
