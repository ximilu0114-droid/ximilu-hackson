#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const [url, outputArg, waitText = ''] = process.argv.slice(2);
if (!url || !outputArg) {
  console.error('usage: node scripts/capture-page.mjs <url> <output.png> [wait text]');
  process.exit(2);
}

const chromePath =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const output = resolve(outputArg);
const profile = mkdtempSync(join(tmpdir(), 'attestflow-capture-'));
const port = 9300 + (process.pid % 500);
const chrome = spawn(
  chromePath,
  [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function pollJson(path, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: path.startsWith('/json/new?') ? 'PUT' : 'GET',
      });
      if (response.ok) return await response.json();
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }
  throw new Error(`Chrome DevTools did not answer ${path}`);
}

try {
  await pollJson('/json/version');
  const target = await pollJson(`/json/new?${encodeURIComponent(url)}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result ?? {});
  });

  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolveCommand, rejectCommand) => {
      pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url });

  const readyDeadline = Date.now() + 20_000;
  let ready = false;
  while (Date.now() < readyDeadline) {
    const result = await send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && ${
        waitText
          ? `document.body.innerText.toLowerCase().includes(${JSON.stringify(waitText.toLowerCase())})`
          : 'true'
      }`,
      returnByValue: true,
    });
    if (result.result?.value === true) {
      ready = true;
      break;
    }
    await delay(150);
  }
  if (!ready) {
    const body = await send('Runtime.evaluate', {
      expression: 'document.body?.innerText ?? ""',
      returnByValue: true,
    });
    const diagnostics = await send('Runtime.evaluate', {
      expression:
        '({ scripts: [...document.scripts].map((s) => s.src).filter(Boolean), resources: performance.getEntriesByType("resource").map((r) => r.name).filter((n) => n.includes("_next")).slice(-10) })',
      returnByValue: true,
    });
    throw new Error(
      `capture page did not become ready${waitText ? ` (missing ${JSON.stringify(waitText)})` : ''}: ${String(
        body.result?.value ?? '',
      ).slice(0, 500)}\n${JSON.stringify(diagnostics.result?.value ?? {})}`,
    );
  }

  await send('Runtime.evaluate', {
    expression:
      'location.hash ? document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" }) : undefined',
  });
  // Give fonts and final compositor work a deterministic settling window.
  await delay(500);
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
  socket.close();
  console.log(output);
} finally {
  chrome.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => chrome.once('exit', resolveExit)),
    delay(2_000),
  ]);
  if (profile.startsWith(join(tmpdir(), 'attestflow-capture-'))) {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // The generated capture is valid even if a late Chrome helper delays temp cleanup.
    }
  }
}
