// Exhaustive spec-level check of the whole-stream permutation
// (requirements 8.10–8.16) for every valid payload length P and both profiles.
//
//   node scripts/check-scramble.mjs            -> rule as written in requirements.md
//   node scripts/check-scramble.mjs explore    -> also evaluates candidate fixes
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

const asWritten = (g) => candidatesA(g)[0];
const base = run('as written: a nearest 0.618L, fraction 0.1', asWritten, 0.1);
for (const f of base.tenths) console.log('   ', JSON.stringify(f));

if (process.argv[2] === 'explore') {
  // Fix A: keep 8.16 but pick the nearest coprime a that also satisfies 8.13 and 8.16.
  const searched = (g, prof) =>
    candidatesA(g).find((a) => window16Ok(g, a) && tenths(g, a, prof.bitsPerSymbol, 0.1).missing.length === 0 ||
      (window16Ok(g, a) && tenths(g, a, prof.bitsPerSymbol, 0.1).vacuous)) ?? candidatesA(g)[0];
  const fixA = run('fix A: nearest a that passes 8.13 and 8.16', searched, 0.1);
  if (fixA.tenths.length) for (const f of fixA.tenths) console.log('   ', JSON.stringify(f));

  // Fix B: keep the a rule, relax the trigger point of 8.16.
  for (const fr of [0.12, 0.15, 0.2]) run(`fix B: a as written, fraction ${fr}`, asWritten, fr);

  // How far from 0.618L does fix A have to move a?
  let maxShift = 0, changed = 0;
  for (const prof of PROFILES) for (let P = 1; P <= prof.maxP; P++) {
    const g = geometry(P);
    const a0 = asWritten(g), a1 = searched(g, prof);
    if (a0 !== a1) { changed++; maxShift = Math.max(maxShift, Math.abs(a1 - 0.618 * g.L) / g.L); }
  }
  console.log(`\nfix A changes a for ${changed} lengths; max |a/L - 0.618| = ${maxShift.toFixed(4)}`);
}
