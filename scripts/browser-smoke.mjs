// Browser smoke test of the dev harness, with no test framework: headless Chrome, a WAV file in
// place of the microphone, the script presses "Listen", waits, and prints the page text. It runs
// the real path after the microphone: MediaStream -> AudioWorklet -> Worker -> decoder -> page.
//
//   npx vite --port 5199 --strictPort            (in another terminal)
//   node scripts/browser-smoke.mjs demo/ghost-tape-demo.wav [seconds]
//
// The file is relative to the project root (the dev server serves it). It loops with 1 s gaps,
// so the log should show one COMPLETE and then "already received". Exits 0 if a COMPLETE
// appeared, 1 otherwise.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const wav = resolve(process.argv[2] ?? 'demo/ghost-tape-demo.wav');
const seconds = Number(process.argv[3] ?? 50);
// Chrome's file-based fake microphone delivered only silence in headless mode on macOS (checked
// 2026-11-23). By default the page's getUserMedia is replaced instead, with the same WAV served
// by the dev server; set GT_FAKE_MIC=chrome to try Chrome's own fake device.
const streamPath = process.env.GT_FAKE_MIC === 'chrome' ? undefined : `/${process.argv[2] ?? 'demo/ghost-tape-demo.wav'}`;
const url = process.env.GT_URL ?? 'http://localhost:5199/';
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9333;
const profile = mkdtempSync(join(tmpdir(), 'gt-chrome-'));

const browser = spawn(chrome, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${wav}`,
  '--autoplay-policy=no-user-gesture-required',
  '--no-first-run',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let socket;
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {
      // Chrome is still starting
    }
  }
  if (!target) throw new Error('Chrome did not start');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((socket.onopen = r), (socket.onerror = j)));
  let id = 0;
  const waiting = new Map();
  socket.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) waiting.get(msg.id)(msg);
  };
  const send = (method, params = {}) => new Promise((r) => {
    const n = ++id;
    waiting.set(n, r);
    socket.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await send('Page.navigate', { url });
  await sleep(2000);
  if (streamPath) {
    // Replace the microphone with the WAV played through Web Audio into a MediaStream, looped
    // with 1 s gaps. Everything after getUserMedia (worklet, worker, decoder, page) is the real code.
    const patched = await evaluate(`(async () => {
      const ctx = new AudioContext({ sampleRate: 48000 });
      const data = await (await fetch(${JSON.stringify(streamPath)})).arrayBuffer();
      const track = await ctx.decodeAudioData(data);
      const looped = ctx.createBuffer(1, track.length + ctx.sampleRate, ctx.sampleRate);
      looped.copyToChannel(track.getChannelData(0), 0);
      navigator.mediaDevices.getUserMedia = async () => {
        await ctx.resume();
        const src = ctx.createBufferSource();
        src.buffer = looped;
        src.loop = true;
        const out = ctx.createMediaStreamDestination();
        src.connect(out);
        src.start();
        return out.stream;
      };
      return track.duration;
    })()`);
    console.log(`microphone replaced by ${streamPath} (${patched} s, looped)`);
  }
  const clicked = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Listen')); b?.click(); return !!b; })()`);
  if (!clicked) throw new Error('no Listen button on the page');
  console.log(`listening to ${wav} for ${seconds} s ...`);
  await sleep(seconds * 1000);
  const log = await evaluate(`[...document.querySelectorAll('p, pre')].map((p) => p.textContent).filter((t) => t.trim() !== '').join('\\n')`);
  console.log(log);
  process.exitCode = /COMPLETE/.test(log ?? '') ? 0 : 1;
} finally {
  socket?.close();
  browser.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
