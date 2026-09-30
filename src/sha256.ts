// SHA-256 over the UTF-8 bytes of a string, in plain JavaScript.
//
// The chart identity is a hash of the source a chart was compiled from, and
// the package runs where no platform digest can be assumed: no `node:crypto`,
// no Web Crypto (which is asynchronous where it exists), no text encoder in
// the language itself. So both halves are written out here - the UTF-8
// encoding as a loop over UTF-16 code units, and the digest as FIPS 180-4
// specifies it, on 32-bit words with no `bigint`.
//
// The reference hashes the source's bytes. A string held here has no bytes
// of its own, so the bytes are the string's UTF-8 encoding, which for a
// source read from a UTF-8 file are the file's bytes. A lone surrogate, which
// UTF-8 cannot encode, becomes U+FFFD, as every standard encoder writes it.

// The first 32 bits of the fractional parts of the cube roots of the first
// 64 primes (FIPS 180-4, 4.2.2).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

// The first 32 bits of the fractional parts of the square roots of the first
// eight primes (FIPS 180-4, 5.3.3).
const INITIAL_HASH = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/** The UTF-8 encoding of `text`, a lone surrogate written as U+FFFD. */
export function utf8Bytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let point = text.charCodeAt(i);
    if (point >= 0xd800 && point <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        point = 0x10000 + ((point - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else {
        point = 0xfffd;
      }
    } else if (point >= 0xdc00 && point <= 0xdfff) {
      point = 0xfffd;
    }

    if (point < 0x80) {
      bytes.push(point);
    } else if (point < 0x800) {
      bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    } else if (point < 0x10000) {
      bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function rotr(word: number, bits: number): number {
  return (word >>> bits) | (word << (32 - bits));
}

/** The SHA-256 digest of `bytes`, as 64 lowercase hexadecimal digits. */
export function sha256Hex(bytes: Uint8Array): string {
  // Padding (FIPS 180-4, 5.1.1): a one bit, zeros to 56 bytes mod 64, then
  // the message length in bits as a 64-bit big-endian integer.
  const length = bytes.length;
  const blocks = Math.ceil((length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length * 8) % 0x100000000);

  const hash = new Uint32Array(INITIAL_HASH);
  const schedule = new Uint32Array(64);
  for (let block = 0; block < blocks; block++) {
    const offset = block * 64;
    for (let t = 0; t < 16; t++) schedule[t] = view.getUint32(offset + t * 4);
    for (let t = 16; t < 64; t++) {
      const w2 = schedule[t - 2] as number;
      const w15 = schedule[t - 15] as number;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      schedule[t] = (s1 + (schedule[t - 7] as number) + s0 + (schedule[t - 16] as number)) | 0;
    }

    let a = hash[0] as number;
    let b = hash[1] as number;
    let c = hash[2] as number;
    let d = hash[3] as number;
    let e = hash[4] as number;
    let f = hash[5] as number;
    let g = hash[6] as number;
    let h = hash[7] as number;
    for (let t = 0; t < 64; t++) {
      const sum1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + (K[t] as number) + (schedule[t] as number)) | 0;
      const sum0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    hash[0] = (hash[0] as number) + a;
    hash[1] = (hash[1] as number) + b;
    hash[2] = (hash[2] as number) + c;
    hash[3] = (hash[3] as number) + d;
    hash[4] = (hash[4] as number) + e;
    hash[5] = (hash[5] as number) + f;
    hash[6] = (hash[6] as number) + g;
    hash[7] = (hash[7] as number) + h;
  }

  let hex = "";
  for (const word of hash) hex += word.toString(16).padStart(8, "0");
  return hex;
}
