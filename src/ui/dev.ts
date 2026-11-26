// Dev harness (design "Audio adapters"): a plain form to make a tape, hear it, save it, decode a
// file and listen on the microphone. It is for the manual trials of tasks 15–16 and is replaced
// by the ghost-tape-ui spec. No styling beyond what keeps it usable on a phone.

import { createFileDecodeContext, decodeAudioFile } from '../audio/file';
import { createDecoderWorker, postToWorker, startListening, type Listening, type Recording } from '../audio/mic';
import { download, playSamples, wavBlob, type Playing } from '../audio/playback';
import type { FromWorker } from '../audio/protocol';
import { encodePayload, PROFILES } from '../modem/index';
import { CHARSET_MARKS } from '../modem/tape';
import type { DecoderEvent, Payload, ProvisionalByte } from '../modem/types';

type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & { css?: string };
const html = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] => {
  const { css, ...rest } = props;
  const el = Object.assign(document.createElement(tag), rest);
  if (css) el.style.cssText = css;
  el.append(...children);
  return el;
};
const field = (label: string, input: HTMLElement): HTMLLabelElement => html('label', { css: 'display:block;margin:4px 0' }, `${label} `, input);

/** A byte as the text it stands for: ASCII as itself, the seven marks, newline as ↵, anything else as a dot. */
function byteChar(b: number): string {
  if (b === 0x0a) return '↵';
  if (b >= 0x20 && b < 0x7f) return String.fromCharCode(b);
  if (b >= 0x80 && b < 0x80 + CHARSET_MARKS.length) return CHARSET_MARKS[b - 0x80]!;
  return '·';
}

/** The darkroom in its rawest form: every payload position, ░ until a byte has arrived. */
function developed(length: number, bytes: readonly ProvisionalByte[]): string {
  const chars = Array.from({ length }, () => '░');
  for (const b of bytes) chars[b.position] = byteChar(b.byte);
  return chars.join('');
}

function describe(e: DecoderEvent, sampleRate: number, pushed?: number): string {
  const at = pushed !== undefined ? `[${(pushed / sampleRate).toFixed(1)} s] ` : '';
  switch (e.type) {
    case 'signal-detected':
      return `${at}signal detected, pass starts at ${(e.atSample / sampleRate).toFixed(3)} s`;
    case 'header':
      return `${at}header: tape ${e.tapeId.toString(16)}, ${e.profile}, ${e.payloadLength} B, pass ${e.pass}, ~${e.estimatedSecondsRemaining.toFixed(1)} s left`;
    case 'progress':
      return `${at}progress ${(100 * e.fractionReceived).toFixed(0)}%, ${e.provisional.length} bytes shown`;
    case 'pass-complete':
      return `${at}pass ${e.pass} complete: ${e.blocksRecovered}/${e.blocksTotal} blocks, clarity ${e.clarity.toFixed(3)}`;
    case 'complete':
      return `${at}COMPLETE after ${e.passesUsed} pass(es)`;
    case 'already-received':
      return `${at}already received`;
    case 'pass-discarded':
      return `${at}pass discarded: ${e.reason}`;
  }
}

export function mountDevHarness(root: HTMLElement): void {
  root.replaceChildren();
  root.style.cssText = 'font:14px/1.4 system-ui,sans-serif;max-width:40rem;margin:1rem auto;padding:0 1rem';

  // ---------- make a tape ----------
  const kind = html('select', {}, html('option', { value: 'tape', textContent: 'Side A: tape' }), html('option', { value: 'ghost', textContent: 'Side B: ghost' }));
  const profile = html('select', {}, ...PROFILES.map((p) => html('option', { value: p.name, textContent: p.name })));
  profile.value = 'standard';
  const rate = html('select', {}, html('option', { value: '48000', textContent: '48000 Hz' }), html('option', { value: '44100', textContent: '44100 Hz' }));
  const title = html('input', { value: 'Side A for you' });
  const from = html('input', { value: 'Angela' });
  const to = html('input', { value: 'A friend' });
  const date = html('input', { placeholder: 'YYYY-MM-DD (optional)' });
  const tracks = html('textarea', { rows: 3, value: 'Track one\nTrack two' });
  const letter = html('textarea', { rows: 4, value: 'This letter was hidden in sound.' });
  const message = html('input', { value: 'A ghost on the air.', size: 40 });
  const tapeFields = html('div', {}, field('Title', title), field('From', from), field('To', to), field('Date', date), field('Tracks (one per line)', tracks), field('Letter', letter));
  const ghostFields = html('div', { hidden: true }, field('Message', message));
  const duration = html('p', { textContent: '…' });

  let track: { samples: Float32Array; sampleRate: number; name: string } | undefined;

  const payload = (): Payload =>
    kind.value === 'ghost'
      ? { kind: 'ghost', message: message.value }
      : {
          kind: 'tape',
          title: title.value,
          from: from.value,
          to: to.value,
          ...(date.value.trim() ? { date: date.value.trim() } : {}),
          tracks: tracks.value.split('\n').map((t) => t.trim()).filter((t) => t !== ''),
          letter: letter.value,
        };

  // R1.4, R1.5: the shown duration is the length of the track actually produced, recomputed on every edit.
  let pending = 0;
  const rebuild = (): void => {
    window.clearTimeout(pending);
    pending = window.setTimeout(() => {
      tapeFields.hidden = kind.value === 'ghost';
      ghostFields.hidden = kind.value !== 'ghost';
      const sampleRate = Number(rate.value);
      const r = encodePayload(payload(), { profile: profile.value, sampleRate });
      if (!r.ok) {
        track = undefined;
        duration.textContent = `Cannot encode: ${r.reason}`;
        return;
      }
      track = { samples: r.value.samples, sampleRate, name: `ghost-tape-${profile.value}-${sampleRate}.wav` };
      duration.textContent = `Ghost track: ${r.value.durationSec.toFixed(1)} s (${profile.value}, ${sampleRate} Hz)`;
    }, 120);
  };
  for (const el of [kind, profile, rate, title, from, to, date, tracks, letter, message]) {
    el.addEventListener('input', rebuild);
    el.addEventListener('change', rebuild);
  }

  // ---------- play, loop, export ----------
  let output: AudioContext | undefined;
  let playing: Playing | undefined;
  const play = (loop: boolean): void => {
    if (!track) return;
    playing?.stop();
    output ??= new AudioContext();
    void output.resume();
    playing = playSamples(output, track.samples, track.sampleRate, loop);
  };
  const playButton = html('button', { textContent: 'Play once', onclick: () => play(false) });
  const loopButton = html('button', { textContent: 'Loop (1 s gaps)', onclick: () => play(true) });
  const stopButton = html('button', { textContent: 'Stop', onclick: () => playing?.stop() });
  const exportButton = html('button', {
    textContent: 'Export WAV',
    onclick: () => {
      if (!track) return;
      const blob = wavBlob(track.samples, track.sampleRate);
      if (blob.ok) download(blob.value, track.name);
      else log(`export failed: ${blob.reason}`);
    },
  });

  // ---------- receive: log and darkroom ----------
  const status = html('p', { textContent: 'Not listening.' });
  const heard = html('p', { textContent: '' });
  const darkroom = html('pre', { css: 'white-space:pre-wrap;word-break:break-all;background:#111;color:#ddd;padding:8px;min-height:3em' });
  const result = html('pre', { css: 'white-space:pre-wrap;background:#f4f4f4;padding:8px' });
  const logBox = html('pre', { css: 'white-space:pre-wrap;max-height:16em;overflow:auto;font-size:12px;border:1px solid #ccc;padding:4px' });
  const trialLog: string[] = [];
  function log(line: string): void {
    const stamped = `${new Date().toISOString().slice(11, 19)} ${line}`;
    trialLog.push(stamped);
    logBox.textContent = trialLog.slice(-200).join('\n');
    logBox.scrollTop = logBox.scrollHeight;
  }
  const copyLog = html('button', { textContent: 'Copy log', onclick: () => void navigator.clipboard?.writeText(trialLog.join('\n')) });

  let payloadLength = 0;
  const show = (events: readonly DecoderEvent[], sampleRate: number, pushed?: number): void => {
    for (const e of events) {
      if (e.type !== 'progress') log(describe(e, sampleRate, pushed));
      if (e.type === 'header') {
        payloadLength = e.payloadLength;
        darkroom.textContent = developed(payloadLength, []);
      } else if (e.type === 'progress') {
        darkroom.textContent = developed(payloadLength, e.provisional);
      } else if (e.type === 'complete') {
        result.textContent = JSON.stringify(e.payload, (_k, v: unknown) => (v instanceof Uint8Array ? `<${v.length} bytes>` : v), 2);
      }
    }
  };

  // ---------- upload ----------
  const upload = html('input', { type: 'file', accept: 'audio/*' });
  upload.addEventListener('change', () => {
    const file = upload.files?.[0];
    if (!file) return;
    void (async () => {
      log(`decoding file ${file.name} (${file.size} bytes)`);
      const decoded = await decodeAudioFile(await file.arrayBuffer(), createFileDecodeContext());
      if (!decoded.ok) {
        log(decoded.reason);
        return;
      }
      const { samples, sampleRate } = decoded.value;
      const worker = createDecoderWorker();
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const m = event.data;
        if (m.type === 'file-result') {
          show(m.events, sampleRate);
          log(m.result.ok ? `file: decoded, ${m.result.passesUsed} pass(es)` : `file: ${m.result.reason} (clarity ${m.result.clarity.toFixed(3)})`);
        } else if (m.type === 'error') log(`worker error: ${m.message}`);
        worker.terminate();
      };
      postToWorker(worker, { type: 'decode-file', samples, sampleRate }, [samples.buffer]);
    })();
  });

  // ---------- record (real-room fixtures, task 16) ----------
  // While ticked, the worker keeps a copy of exactly what the decoder is given (gap fill included);
  // Stop saves it as a 16-bit WAV named with the label and the UTC time, ready for tests/fixtures/real-room/.
  const recordBox = html('input', { type: 'checkbox' });
  const recordLabel = html('input', { value: '1m-70pct', size: 14 });
  recordBox.addEventListener('change', () => listening?.record(recordBox.checked));
  const saveRecording = (r: Recording): void => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    const label = recordLabel.value.trim().replace(/[^A-Za-z0-9._-]+/g, '-') || 'play';
    const blob = wavBlob(r.samples, r.sampleRate);
    if (!blob.ok) {
      log(`recording not saved: ${blob.reason}`);
      return;
    }
    const name = `real-room-${label}-${stamp}Z.wav`;
    download(blob.value, name);
    log(`saved ${name}: ${(r.samples.length / r.sampleRate).toFixed(1)} s at ${r.sampleRate} Hz${r.truncated ? ' (cut at the 10-minute cap)' : ''}`);
  };

  // ---------- listen ----------
  let listening: Listening | undefined;
  const listenButton = html('button', { textContent: 'Listen (mic)' });
  listenButton.onclick = () => {
    void (async () => {
      if (listening) {
        const l = listening;
        listening = undefined;
        listenButton.textContent = 'Listen (mic)';
        listenButton.disabled = true;
        const taken = recordBox.checked ? await l.stopAndTakeRecording() : (await l.stop(), undefined);
        listenButton.disabled = false;
        status.textContent = 'Not listening.';
        log('stopped listening');
        if (taken) saveRecording(taken);
        return;
      }
      listenButton.disabled = true;
      const started = await startListening({
        onEvents: (events, pushed, levelDb, gapSamples) => {
          const sampleRate = listening?.sampleRate ?? 48000;
          const gaps = gapSamples > 0 ? `; ${(gapSamples / sampleRate).toFixed(3)} s of audio lost and filled with silence` : '';
          heard.textContent = `Heard ${(pushed / sampleRate).toFixed(0)} s of audio; input level ${levelDb.toFixed(0)} dBFS${gaps}.`;
          show(events, sampleRate, pushed);
        },
        onError: (m) => log(`worker error: ${m}`),
      });
      listenButton.disabled = false;
      if (!started.ok) {
        status.textContent = started.reason;
        log(started.reason);
        return;
      }
      listening = started.value;
      if (recordBox.checked) started.value.record(true);
      listenButton.textContent = 'Stop listening';
      status.textContent = `Listening at ${started.value.sampleRate} Hz (echo cancellation, noise suppression and AGC off).`;
      log(`listening at ${started.value.sampleRate} Hz`);
    })();
  };
  const clearButton = html('button', {
    textContent: 'Clear screen',
    onclick: () => {
      darkroom.textContent = '';
      result.textContent = '';
    },
  });

  root.append(
    html('h1', { textContent: 'Ghost Tape — dev harness' }),
    html('h2', { textContent: 'Make' }),
    field('Kind', kind),
    field('Profile', profile),
    field('Sample rate', rate),
    tapeFields,
    ghostFields,
    duration,
    html('p', {}, playButton, ' ', loopButton, ' ', stopButton, ' ', exportButton),
    html('h2', { textContent: 'Receive' }),
    html('p', {}, listenButton, ' ', clearButton),
    html('p', {}, html('label', {}, recordBox, ' Record raw audio while listening (saved as WAV on Stop), label '), recordLabel),
    status,
    heard,
    field('Or decode a file', upload),
    darkroom,
    result,
    html('h2', { textContent: 'Log' }),
    html('p', {}, copyLog),
    logBox,
  );
  rebuild();
}
