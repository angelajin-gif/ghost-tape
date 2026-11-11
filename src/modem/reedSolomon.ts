// Reed–Solomon over GF(2^8) (design.md, "Payload pipeline" step 3 and "Header").
//
// Field: bytes are elements of GF(256) built from the primitive polynomial
// x^8 + x^4 + x^3 + x^2 + 1 (0x11D), with generator alpha = 2. Addition is XOR;
// multiplication uses log/antilog tables.
//
// Code: systematic, data first then parity. The generator polynomial has roots
// alpha^0 .. alpha^(nParity-1) (first consecutive root 0, same as QR codes).
// A codeword of n <= 255 bytes is a shortened RS(255, 255 - nParity) code: the
// missing leading bytes are implicit zeros, so the same maths applies.
// With nParity parity bytes the decoder corrects up to floor(nParity / 2) byte errors.
//
// Byte order: codeword[0] is the coefficient of the highest power of x, so
// codeword c represents c(x) = c[0]·x^(n-1) + ... + c[n-1].

import type { Result } from './types';

const PRIMITIVE_POLY = 0x11d;
export const MAX_CODEWORD_LENGTH = 255;

// EXP[i] = alpha^i. Doubled to 510 entries so EXP[LOG[a] + LOG[b]] needs no "mod 255".
const EXP = new Uint8Array(510);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1; // multiply by alpha (= x)
    if (x & 0x100) x ^= PRIMITIVE_POLY; // reduce modulo the field polynomial
  }
  for (let i = 255; i < 510; i++) EXP[i] = EXP[i - 255]!;
})();

/** Multiply in GF(256): add the logarithms. */
export function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!;
}

/** Divide in GF(256): subtract the logarithms. b must be non-zero. */
export function gfDiv(a: number, b: number): number {
  return a === 0 ? 0 : EXP[LOG[a]! + 255 - LOG[b]!]!;
}

/** alpha^e for any integer e (alpha has order 255). */
export function gfAlphaPow(e: number): number {
  return EXP[((e % 255) + 255) % 255]!;
}

// ---------- polynomials ----------
// Two orderings are used, each where it keeps the maths readable:
// "high-first" for codewords and the generator (matches transmission order),
// "low-first" (index = power of x) for the decoder's locator and evaluator.

/** Evaluate a high-first polynomial at x (Horner's rule). */
function evalHighFirst(p: Uint8Array, x: number): number {
  let y = 0;
  for (let i = 0; i < p.length; i++) y = gfMul(y, x) ^ p[i]!;
  return y;
}

/** Evaluate a low-first polynomial at x. */
function evalLowFirst(p: readonly number[], x: number): number {
  let y = 0;
  for (let i = p.length - 1; i >= 0; i--) y = gfMul(y, x) ^ p[i]!;
  return y;
}

// g(x) = (x - alpha^0)(x - alpha^1)...(x - alpha^(nParity-1)), high-first, monic.
const generatorCache = new Map<number, Uint8Array>();
function generator(nParity: number): Uint8Array {
  const cached = generatorCache.get(nParity);
  if (cached) return cached;
  let g = Uint8Array.of(1);
  for (let j = 0; j < nParity; j++) {
    // Multiply g by (x + alpha^j); minus is plus in GF(2^8).
    const next = new Uint8Array(g.length + 1);
    const root = gfAlphaPow(j);
    for (let i = 0; i < g.length; i++) {
      next[i]! ^= g[i]!;
      next[i + 1]! ^= gfMul(g[i]!, root);
    }
    g = next;
  }
  generatorCache.set(nParity, g);
  return g;
}

function checkParams(dataLength: number, nParity: number): string | undefined {
  if (!Number.isInteger(nParity) || nParity < 1) return `nParity must be a positive integer, got ${nParity}`;
  if (dataLength < 1) return 'data must not be empty';
  if (dataLength + nParity > MAX_CODEWORD_LENGTH) {
    return `codeword length ${dataLength + nParity} exceeds ${MAX_CODEWORD_LENGTH}`;
  }
  return undefined;
}

/**
 * Systematic encode: returns data followed by nParity parity bytes.
 * Parity = remainder of data(x)·x^nParity divided by g(x), so the whole
 * codeword is a multiple of g(x) and therefore zero at every root of g.
 */
export function rsEncode(data: Uint8Array, nParity: number): Result<Uint8Array> {
  const bad = checkParams(data.length, nParity);
  if (bad) return { ok: false, reason: bad };
  const g = generator(nParity);
  const work = new Uint8Array(data.length + nParity);
  work.set(data);
  // Polynomial long division; g is monic so each step just subtracts coef·g.
  for (let i = 0; i < data.length; i++) {
    const coef = work[i]!;
    if (coef === 0) continue;
    for (let j = 1; j < g.length; j++) work[i + j]! ^= gfMul(g[j]!, coef);
  }
  // The division overwrote the data positions with partial remainders; restore them.
  work.set(data);
  return { ok: true, value: work };
}

export interface RsDecoded {
  readonly data: Uint8Array;
  readonly errorsCorrected: number;
}

/**
 * Decode a codeword (data + nParity parity bytes). Corrects up to floor(nParity/2)
 * byte errors. Returns a failure when it detects more errors than it can fix.
 * Beyond capacity a bounded-distance decoder can also land on a *different* valid
 * codeword; the CRC-32 over the payload catches that case (R7.3). Never throws.
 */
export function rsDecode(codeword: Uint8Array, nParity: number): Result<RsDecoded> {
  const bad = checkParams(codeword.length - nParity, nParity);
  if (bad) return { ok: false, reason: bad };
  const n = codeword.length;
  const r = codeword.slice();

  // 1. Syndromes: evaluate the received word at each root of g. A valid codeword
  //    gives all zeros; any non-zero syndrome means at least one byte is wrong.
  const syndromes = computeSyndromes(r, nParity);
  if (syndromes.every((s) => s === 0)) return { ok: true, value: { data: r.slice(0, n - nParity), errorsCorrected: 0 } };

  // 2. Berlekamp–Massey: find the shortest error-locator polynomial Lambda(x)
  //    whose roots point at the error positions.
  const lambda = berlekampMassey(syndromes);
  const errorCount = lambda.length - 1;
  if (errorCount * 2 > nParity) return { ok: false, reason: 'too many errors' };

  // 3. Chien search: try every position; position i is wrong when
  //    Lambda(X^-1) = 0, with X = alpha^(n-1-i) the position's "locator".
  const positions: number[] = [];
  for (let i = 0; i < n; i++) {
    if (evalLowFirst(lambda, gfAlphaPow(-(n - 1 - i))) === 0) positions.push(i);
  }
  // Fewer roots inside the codeword than the locator's degree means the errors
  // point outside the (shortened) codeword: uncorrectable.
  if (positions.length !== errorCount) return { ok: false, reason: 'error locator roots do not match error count' };

  // 4. Forney: compute each error's value from the error evaluator
  //    Omega(x) = S(x)·Lambda(x) mod x^nParity and the derivative Lambda'(x):
  //    e = X · Omega(X^-1) / Lambda'(X^-1)   (form for first root alpha^0).
  const omega = multiplyLowFirst(syndromes, lambda).slice(0, nParity);
  const lambdaDerivative = formalDerivative(lambda);
  for (const i of positions) {
    const x = gfAlphaPow(n - 1 - i);
    const xInv = gfAlphaPow(-(n - 1 - i));
    const denominator = evalLowFirst(lambdaDerivative, xInv);
    if (denominator === 0) return { ok: false, reason: 'zero derivative in Forney step' };
    r[i]! ^= gfMul(x, gfDiv(evalLowFirst(omega, xInv), denominator));
  }

  // 5. Check: the corrected word must be a codeword again.
  if (!computeSyndromes(r, nParity).every((s) => s === 0)) return { ok: false, reason: 'correction did not produce a codeword' };
  return { ok: true, value: { data: r.slice(0, n - nParity), errorsCorrected: errorCount } };
}

function computeSyndromes(r: Uint8Array, nParity: number): number[] {
  const s: number[] = [];
  for (let j = 0; j < nParity; j++) s.push(evalHighFirst(r, gfAlphaPow(j)));
  return s;
}

/**
 * Berlekamp–Massey over GF(256). Input: syndromes S_0..S_(2t-1). Output: the
 * error locator Lambda(x) low-first, Lambda[0] = 1, trimmed to its degree.
 * It builds Lambda step by step; whenever the current Lambda fails to predict the
 * next syndrome (discrepancy d != 0) it is patched with a shifted copy of an
 * earlier version, growing its degree only when it has to.
 */
function berlekampMassey(s: readonly number[]): number[] {
  let c: number[] = [1]; // current locator
  let b: number[] = [1]; // locator before the last length change
  let length = 0; // current number of assumed errors
  let shift = 1; // steps since b was saved
  let bDiscrepancy = 1;
  for (let k = 0; k < s.length; k++) {
    // Discrepancy: how far the current locator is from predicting S_k.
    let d = s[k]!;
    for (let i = 1; i <= length; i++) d ^= gfMul(c[i] ?? 0, s[k - i]!);
    if (d === 0) {
      shift++;
      continue;
    }
    const scale = gfDiv(d, bDiscrepancy);
    const patched = c.slice();
    while (patched.length < b.length + shift) patched.push(0);
    for (let i = 0; i < b.length; i++) patched[i + shift]! ^= gfMul(scale, b[i]!);
    if (2 * length <= k) {
      b = c;
      length = k + 1 - length;
      bDiscrepancy = d;
      shift = 1;
    } else {
      shift++;
    }
    c = patched;
  }
  // Trim to the locator's real degree; coefficients above `length` are zero.
  return c.slice(0, length + 1);
}

function multiplyLowFirst(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j]! ^= gfMul(a[i]!, b[j]!);
  }
  return out;
}

/** d/dx in characteristic 2: even powers vanish, odd powers k·x^(k-1) keep their coefficient. */
function formalDerivative(p: readonly number[]): number[] {
  const out: number[] = [];
  for (let k = 1; k < p.length; k++) out.push(k % 2 === 1 ? p[k]! : 0);
  return out;
}
