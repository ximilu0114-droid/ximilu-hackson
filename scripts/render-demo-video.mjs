#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(
  readFileSync(join(root, 'docs', 'demo-video-scenes.json'), 'utf8'),
);
const work = mkdtempSync(join(tmpdir(), 'attestflow-video-'));
const outputVideo = join(root, 'docs', 'attestflow-demo-review.mp4');
const outputCaptions = join(root, 'docs', 'attestflow-demo-review.srt');
const outputPoster = join(root, 'docs', 'attestflow-demo-poster.png');
const baseUrl = 'http://localhost:3110';
const finalSpeed = Number(config.finalSpeed ?? 1);

const sourcePaths = {
  'judge-top': join(work, 'judge-top.png'),
  dashboard: join(work, 'dashboard.png'),
  'judge-security': join(work, 'judge-security.png'),
  'verifier-terminal': join(work, 'verifier-terminal.png'),
  'cc3-transaction': join(work, 'cc3-transaction.png'),
  'delivery-transaction': join(work, 'delivery-transaction.png'),
  closing: join(work, 'closing.png'),
};

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: options.quiet ? 'ignore' : 'inherit',
    });
    child.once('error', rejectRun);
    child.once('exit', (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with ${code}`));
    });
  });
}

function runCapture(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.once('error', rejectRun);
    child.once('exit', (code) => {
      if (code === 0) resolveRun(stdout);
      else rejectRun(new Error(`${command} exited with ${code}: ${stderr.slice(-2_000)}`));
    });
  });
}

function capture(url, output, waitText) {
  return run(process.execPath, [join(root, 'scripts', 'capture-page.mjs'), url, output, waitText]);
}

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function waitForDashboard(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/events`);
      if (response.ok) {
        const body = await response.json();
        if (body.stats?.rules === 1 && body.stats?.settled === 1 && body.stats?.deliveries === 1) {
          return;
        }
      }
    } catch {
      // The production server is still starting.
    }
    await delay(150);
  }
  throw new Error('demo dashboard did not start with the recorded live fixture');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function wrapperHtml(scene, source) {
  const position = scene.captionPosition === 'top' ? 'top: 74px;' : 'bottom: 58px;';
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#020806}
body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}
.shot{position:absolute;inset:0;width:1920px;height:1080px;object-fit:cover}
.wash{position:absolute;inset:0;background:linear-gradient(180deg,rgba(1,8,6,.12),transparent 35%,rgba(1,8,6,.38))}
.label{position:absolute;top:40px;left:48px;padding:10px 16px;border:1px solid rgba(52,211,153,.42);border-radius:999px;background:rgba(2,8,6,.82);color:#6ee7b7;font-size:18px;font-weight:750;letter-spacing:.14em}
.caption{position:absolute;${position}left:50%;transform:translateX(-50%);width:1660px;padding:22px 30px;border:1px solid rgba(148,163,184,.25);border-radius:18px;background:rgba(2,6,23,.88);box-shadow:0 16px 60px rgba(0,0,0,.5);color:#f8fafc;text-align:center;font-size:38px;font-weight:650;line-height:1.28;letter-spacing:-.015em}
</style></head><body>
<img class="shot" src="${pathToFileURL(source).href}"><div class="wash"></div>
<div class="label">${escapeHtml(scene.label)}</div>
<div class="caption">${escapeHtml(scene.caption)}</div>
</body></html>`;
}

function closingHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden}
body{display:grid;place-items:center;background:radial-gradient(circle at 50% 25%,#073d2d 0,#03120e 38%,#010504 75%);font-family:Inter,-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;color:#f8fafc}
.wrap{width:1580px;text-align:center}.mark{display:inline-flex;align-items:center;gap:12px;padding:9px 18px;border:1px solid rgba(52,211,153,.35);border-radius:999px;background:rgba(16,185,129,.1);color:#6ee7b7;font-size:18px;font-weight:750;letter-spacing:.15em}
h1{margin:38px 0 12px;font-size:104px;line-height:1;letter-spacing:-.065em}h2{margin:0 auto;color:#6ee7b7;font-size:40px;font-weight:520;letter-spacing:-.025em}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin:58px auto 46px}.metric{padding:26px 18px;border:1px solid rgba(148,163,184,.22);border-radius:18px;background:rgba(15,23,42,.58)}.metric strong{display:block;color:#34d399;font-size:40px}.metric span{display:block;margin-top:8px;color:#94a3b8;font-size:17px;letter-spacing:.06em;text-transform:uppercase}
.url{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#cbd5e1;font-size:23px}.claim{margin-top:28px;color:#e2e8f0;font-size:31px;font-weight:650}
</style></head><body><main class="wrap">
<div class="mark">BUIDL CTC 2026 FALL · AI</div><h1>AttestFlow</h1><h2>Proof-Gated Cross-Chain Payments</h2>
<div class="metrics"><div class="metric"><strong>3</strong><span>linked live transactions</span></div><div class="metric"><strong>62</strong><span>cross-chain checks</span></div><div class="metric"><strong>28</strong><span>automated tests</span></div><div class="metric"><strong>0</strong><span>trusted payment assertions</span></div></div>
<div class="url">github.com/ximilu0114-droid/ximilu-hackson</div><div class="claim">Natural language for intent · Attestcoin for truth · deterministic contracts for money</div>
</main></body></html>`;
}

function terminalHtml(rawOutput) {
  const clean = rawOutput.replace(/\u001b\[[0-9;]*m/g, '').trim();
  const highlighted = escapeHtml(clean)
    .replace('"status": "SUCCESS"', '<span class="ok">"status": "SUCCESS"</span>')
    .replace('"checks": 62', '<span class="ok">"checks": 62</span>');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden}
body{display:grid;place-items:center;background:radial-gradient(circle at 50% 20%,#10201b 0,#030706 58%,#010303 100%);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:#dbeafe}
.terminal{width:1600px;min-height:760px;border:1px solid #334155;border-radius:22px;background:rgba(2,6,23,.96);box-shadow:0 36px 100px rgba(0,0,0,.58);overflow:hidden}
.bar{display:flex;align-items:center;gap:10px;height:58px;padding:0 24px;border-bottom:1px solid #1e293b;background:#0f172a}.dot{width:14px;height:14px;border-radius:50%}.r{background:#fb7185}.y{background:#fbbf24}.g{background:#34d399}.title{margin-left:14px;color:#94a3b8;font:600 16px Inter,-apple-system,sans-serif;letter-spacing:.05em}
pre{margin:0;padding:34px 44px 40px;white-space:pre-wrap;font-size:23px;line-height:1.42;color:#cbd5e1}.command{color:#6ee7b7}.ok{color:#34d399;font-weight:800}
</style></head><body><main class="terminal"><div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="title">attestflow — live public-chain verification</span></div><pre><span class="command">$ npm run verify:evidence</span>\n\n${highlighted}</pre></main></body></html>`;
}

function probeDuration(path) {
  return new Promise((resolveDuration, rejectDuration) => {
    let output = '';
    const child = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path],
      { cwd: root },
    );
    child.stdout.on('data', (chunk) => (output += chunk));
    child.once('error', rejectDuration);
    child.once('exit', (code) => {
      const duration = Number.parseFloat(output.trim());
      if (code === 0 && Number.isFinite(duration)) resolveDuration(duration);
      else rejectDuration(new Error(`could not read duration for ${path}`));
    });
  });
}

function srtTime(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

let server;
try {
  mkdirSync(work, { recursive: true });
  await run('npm', ['run', 'build', '--prefix', 'web']);
  server = spawn(
    process.execPath,
    [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', 'web', '-p', '3110'],
    {
      cwd: root,
      env: {
        ...process.env,
        AGENT_STATE_FILE: join(root, 'evidence', 'demo-dashboard-state.json'),
      },
      stdio: 'ignore',
    },
  );
  await waitForDashboard();

  await capture(`${baseUrl}/judge`, sourcePaths['judge-top'], '62 live checks passing');
  await capture(`${baseUrl}/`, sourcePaths.dashboard, 'live-v2');
  await capture(`${baseUrl}/judge#security`, sourcePaths['judge-security'], 'What the verifier proves');
  await capture(
    'https://creditcoin-testnet.blockscout.com/tx/0xec29d5b4046d5557c014d6720e6d3799ba0f0b41e31a71147240a09b89c2e4c2',
    sourcePaths['cc3-transaction'],
    '0xec29d5',
  );
  await capture(
    'https://eth-sepolia.blockscout.com/tx/0xc692a176f78b1541104e9e0a18f9a8404c585b15e9be2c695df3d118796947fb',
    sourcePaths['delivery-transaction'],
    '0xc692a176',
  );

  const verificationOutput = await runCapture('npm', ['run', 'verify:evidence']);
  const terminalPath = join(work, 'verifier-terminal.html');
  writeFileSync(terminalPath, terminalHtml(verificationOutput));
  await capture(
    pathToFileURL(terminalPath).href,
    sourcePaths['verifier-terminal'],
    '"status": "SUCCESS"',
  );

  const closingPath = join(work, 'closing.html');
  writeFileSync(closingPath, closingHtml());
  await capture(pathToFileURL(closingPath).href, sourcePaths.closing, 'AttestFlow');

  const segments = [];
  let timeline = 0;
  const subtitles = [];

  for (const [index, scene] of config.scenes.entries()) {
    const wrapper = join(work, `${scene.id}.html`);
    const frame = join(work, `${scene.id}.png`);
    const audio = join(work, `${scene.id}.aiff`);
    const video = join(work, `${scene.id}.mp4`);
    writeFileSync(wrapper, wrapperHtml(scene, sourcePaths[scene.source]));
    await capture(pathToFileURL(wrapper).href, frame, scene.label);
    await run('say', [
      '-v',
      config.voice,
      '-r',
      String(config.rate),
      '-o',
      audio,
      scene.narration,
    ]);

    const audioDuration = await probeDuration(audio);
    const sceneDuration = audioDuration + 0.75;
    const fadeOut = Math.max(0.25, sceneDuration - 0.25);
    await run('ffmpeg', [
      '-y',
      '-loop',
      '1',
      '-framerate',
      '30',
      '-i',
      frame,
      '-i',
      audio,
      '-filter_complex',
      `[0:v]scale=1920:1080,zoompan=z='min(zoom+0.00005,1.02)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30,fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOut.toFixed(3)}:d=0.25,format=yuv420p[v];[1:a]adelay=300:all=1,apad=pad_dur=0.45[a]`,
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-t',
      sceneDuration.toFixed(3),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '19',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      video,
    ], { quiet: true });

    segments.push(video);
    subtitles.push(
      `${index + 1}\n${srtTime(timeline / finalSpeed)} --> ${srtTime(
        (timeline + sceneDuration) / finalSpeed,
      )}\n${scene.narration}\n`,
    );
    timeline += sceneDuration;
  }

  const concatFile = join(work, 'concat.txt');
  writeFileSync(
    concatFile,
    segments.map((segment) => `file '${segment.replaceAll("'", "'\\''")}'`).join('\n') + '\n',
  );
  const assembled = join(work, 'assembled.mp4');
  await run('ffmpeg', [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatFile,
    '-c',
    'copy',
    assembled,
  ], { quiet: true });
  await run('ffmpeg', [
    '-y',
    '-i',
    assembled,
    '-filter_complex',
    `[0:v]setpts=PTS/${finalSpeed}[v];[0:a]atempo=${finalSpeed}[a]`,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '19',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-metadata',
    'title=AttestFlow — Proof-Gated Cross-Chain Payments',
    '-metadata',
    'comment=BUIDL CTC 2026 Fall evidence cut',
    outputVideo,
  ], { quiet: true });
  writeFileSync(outputCaptions, subtitles.join('\n'));
  copyFileSync(join(work, 'outcome.png'), outputPoster);

  const finalDuration = await probeDuration(outputVideo);
  console.log(
    JSON.stringify(
      {
        video: outputVideo,
        captions: outputCaptions,
        poster: outputPoster,
        durationSeconds: Number(finalDuration.toFixed(3)),
        scenes: config.scenes.length,
      },
      null,
      2,
    ),
  );
} finally {
  if (server) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolveExit) => server.once('exit', resolveExit)),
      delay(2_000),
    ]);
  }
  if (work.startsWith(join(tmpdir(), 'attestflow-video-'))) {
    try {
      rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // A late encoder helper can briefly retain a generated temp file.
    }
  }
}
