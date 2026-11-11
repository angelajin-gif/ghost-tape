// Exhaustive spec-level check of the whole-stream permutation
// (requirements 8.10–8.16) for every valid payload length P and both profiles.
//
//   node scripts/check-scramble.mjs            -> approved R8.11 rule (exit 1 on any failure)
//   node scripts/check-scramble.mjs old        -> rule before design review, for the write-up
//
// This is a design-time check; the real property tests live in tests/properties/.

const PROFILES = [
  { name: 'standard', bitsPerSymbol: 4, maxP: 1024 },
  { name: 'robust', bitsPerSymbol: 2, maxP: 256 },
];
const PILOT_EVERY = 32; // one pilot after every 32 data symbols (design.md)

const gcd = (x, y) => (y === 0 ? x : gcd(y, x % y));

function geometry(P) {
  const M = P + 4;               // payload + CRC-32
  const B = Math.ceil(M / 223);  // RS blocks
  const k = Math.ceil(M / B);    // data bytes per block after zero-padding (8.10)
  return { P, M, B, k, L: B * (k + 32) };
}

// Coprime multipliers ordered by distance from 0.618·L; ties -> smaller first (8.11).
function candidatesA(g) {
  const target = 0.618 * g.L;
  const out = [];
  for (let a = 1; a < g.L; a++) if (gcd(a, g.L) === 1 && gcd(a, g.B) === 1) out.push(a);
  return out.sort((x, y) => Math.abs(x - target) - Math.abs(y - target) || x - y);
}

// Transmitted byte i -> final payload position, or -1 for CRC, padding or parity.
// Interleave = byte 0 of every block, then byte 1...; RS is systematic (data first).
function positionOf(i, g, a) {
  const j = (a * i) % g.L;
  const posInBlock = Math.floor(j / g.B);
  if (posInBlock >= g.k) return -1;
  return (j % g.B) * g.k + posInBlock;
}

const isBijection = (g, a) => {
  const seen = new Uint8Array(g.L);
  for (let i = 0; i < g.L; i++) seen[(a * i) % g.L] = 1;
  return seen.every((v) => v === 1);
};

const window16Ok = (g, a) => {
  if (g.B > 16) return true;
  for (let s = 0; s + 16 <= g.L; s++) {
    const blocks = new Set();
    for (let i = s; i < s + 16; i++) blocks.add(((a * i) % g.L) % g.B);
    if (blocks.size < g.B) return false;
  }
  return true;
};

// 8.16: after ceil(fraction·S) payload symbols (S counts pilots), carrying >= 20
// payload bytes, every tenth of 0..P-1 has at least one provisional byte.
function tenths(g, a, bitsPerSymbol, fraction) {
  const D = Math.ceil((8 * g.L) / bitsPerSymbol);
  const S = D + Math.floor(D / PILOT_EVERY);
  const nSym = Math.ceil(fraction * S);
  const dataSym = nSym - Math.floor(nSym / (PILOT_EVERY + 1));
  const bytesIn = Math.floor((dataSym * bitsPerSymbol) / 8);
  const hit = new Uint8Array(10);
  let payloadBytes = 0;
  for (let i = 0; i < bytesIn; i++) {
    const pos = positionOf(i, g, a);
    if (pos < 0 || pos >= g.P) continue;
    payloadBytes++;
    for (let t = 0; t < 10; t++) {
      if (pos >= Math.floor((t * g.P) / 10) && pos < Math.floor(((t + 1) * g.P) / 10)) hit[t] = 1;
    }
  }
  const missing = [];
  for (let t = 0; t < 10; t++) if (!hit[t]) missing.push(t);
  return { vacuous: payloadBytes < 20, payloadBytes, missing };
}

// chooser(g, prof) -> a. Returns a summary over every P of both profiles.
function run(label, chooser, fraction) {
  let cases = 0, vacuous = 0;
  const fail = { bijection: [], window16: [], tenths: [] };
  for (const prof of PROFILES) {
    for (let P = 1; P <= prof.maxP; P++) {
      const g = geometry(P);
      const a = chooser(g, prof);
      cases++;
      if (!isBijection(g, a)) fail.bijection.push(P);
      if (!window16Ok(g, a)) fail.window16.push(P);
      const t = tenths(g, a, prof.bitsPerSymbol, fraction);
      if (t.vacuous) { vacuous++; continue; }
      if (t.missing.length) {
        fail.tenths.push({ prof: prof.name, P, L: g.L, B: g.B, a, payloadBytes: t.payloadBytes, missing: t.missing });
      }
    }
  }
  console.log(`\n[${label}] cases=${cases} vacuous(8.16 precondition unmet)=${vacuous}`);
  console.log(`  8.12 bijection failures: ${fail.bijection.length}`);
  console.log(`  8.13 16-byte window failures: ${fail.window16.length}`);
  console.log(`  8.16 tenths failures: ${fail.tenths.length}`);
  return fail;
}

// Old rule (before design review): nearest coprime to 0.618·L, no further check.
const oldRule = (g) => candidatesA(g)[0];

// Approved R8.11: nearest coprime to 0.618·L whose order passes 8.13 (B <= 16)
// and 8.16 for this profile. A vacuous 8.16 case counts as passing.
// Returns undefined if no candidate exists, so the caller can report it.
function approvedRule(g, prof) {
  return candidatesA(g).find((a) => {
    if (!window16Ok(g, a)) return false;
    const t = tenths(g, a, prof.bitsPerSymbol, 0.1);
    return t.vacuous || t.missing.length === 0;
  });
}

const mode = process.argv[2] ?? 'approved';

if (mode === 'approved') {
  const noCandidate = [];
  const changed = [];
  let maxShift = 0;
  for (const prof of PROFILES) for (let P = 1; P <= prof.maxP; P++) {
    const g = geometry(P);
    const a = approvedRule(g, prof);
    if (a === undefined) { noCandidate.push({ prof: prof.name, P }); continue; }
    const a0 = oldRule(g);
    if (a !== a0) {
      changed.push({ prof: prof.name, P, L: g.L, B: g.B, oldA: a0, a });
      maxShift = Math.max(maxShift, Math.abs(a - 0.618 * g.L) / g.L);
    }
  }
  console.log(`lengths with no valid a: ${noCandidate.length}`);
  for (const c of noCandidate) console.log('   ', JSON.stringify(c));
  // Fall back to the old a only so run() can still report; noCandidate already fails the check.
  const res = run('approved R8.11 rule', (g, prof) => approvedRule(g, prof) ?? oldRule(g), 0.1);
  console.log(`\na differs from the old rule for ${changed.length} lengths; max |a/L - 0.618| = ${maxShift.toFixed(4)}`);
  for (const c of changed) console.log('   ', JSON.stringify(c));
  const failures = noCandidate.length + res.bijection.length + res.window16.length + res.tenths.length;
  console.log(failures === 0 ? '\nOK: approved rule passes 8.12, 8.13 and 8.16 for every case' : `\nFAIL: ${failures} problems`);
  process.exitCode = failures === 0 ? 0 : 1;
} else if (mode === 'old') {
  const base = run('old rule: a nearest 0.618L, fraction 0.1', oldRule, 0.1);
  for (const f of base.tenths) console.log('   ', JSON.stringify(f));
  // Relaxing the trigger point did not fix the old rule either (kept for the write-up).
  for (const fr of [0.12, 0.15, 0.2]) run(`old rule, fraction ${fr}`, oldRule, fr);
} else {
  console.log('usage: node scripts/check-scramble.mjs [approved | old]');
  process.exitCode = 2;
}
