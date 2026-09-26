const SHIFT_AMOUNTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
] as const;

const ROUND_CONSTANTS = new Uint32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);

function rotateLeft(value: number, amount: number): number {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

function add32(left: number, right: number): number {
  const low = (left & 0xffff) + (right & 0xffff);
  const high = (left >>> 16) + (right >>> 16) + (low >>> 16);
  return ((high << 16) | (low & 0xffff)) >>> 0;
}

function md5RoundCore(functionValue: number, a: number, b: number, word: number, shift: number, constant: number): number {
  return add32(rotateLeft(add32(add32(a, functionValue), add32(word, constant)), shift), b);
}

function md5RoundF(a: number, b: number, c: number, d: number, word: number, shift: number, constant: number): number {
  return md5RoundCore((b & c) | (~b & d), a, b, word, shift, constant);
}

function md5RoundG(a: number, b: number, c: number, d: number, word: number, shift: number, constant: number): number {
  return md5RoundCore((b & d) | (c & ~d), a, b, word, shift, constant);
}

function md5RoundH(a: number, b: number, c: number, d: number, word: number, shift: number, constant: number): number {
  return md5RoundCore(b ^ c ^ d, a, b, word, shift, constant);
}

function md5RoundI(a: number, b: number, c: number, d: number, word: number, shift: number, constant: number): number {
  return md5RoundCore(c ^ (b | ~d), a, b, word, shift, constant);
}

function paddedBytes(input: Uint8Array): Uint8Array {
  const length = input.length;
  const paddedLength = Math.ceil((length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[length] = 0x80;
  const bitLength = length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x1_0000_0000), true);
  return padded;
}

/**
 * MD5 is required by Baidu's legacy signing protocol. This local, bundled
 * implementation accepts UTF-8 text and always emits a 32-character lower
 * case hexadecimal digest; it makes no network or Web Crypto calls.
 */
export function baiduMd5Hex(value: string): string {
  const bytes = paddedBytes(new TextEncoder().encode(value));
  let stateA = 1732584193;
  let stateB = -271733879;
  let stateC = -1732584194;
  let stateD = 271733878;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Uint32Array(16);
    const block = new DataView(bytes.buffer, offset, 64);
    for (let index = 0; index < 16; index += 1) words[index] = block.getUint32(index * 4, true);

    let a = stateA;
    let b = stateB;
    let c = stateC;
    let d = stateD;
    const step = (operation: typeof md5RoundF, wordIndex: number, shift: number, constantIndex: number): void => {
      const next = operation(a, b, c, d, words[wordIndex]!, shift, ROUND_CONSTANTS[constantIndex]!);
      a = d;
      d = c;
      c = b;
      b = next;
    };
    for (let index = 0; index < 16; index += 1) step(md5RoundF, index, SHIFT_AMOUNTS[index]!, index);
    for (let index = 16; index < 32; index += 1) step(md5RoundG, (5 * index + 1) % 16, SHIFT_AMOUNTS[index]!, index);
    for (let index = 32; index < 48; index += 1) step(md5RoundH, (3 * index + 5) % 16, SHIFT_AMOUNTS[index]!, index);
    for (let index = 48; index < 64; index += 1) step(md5RoundI, (7 * index) % 16, SHIFT_AMOUNTS[index]!, index);
    stateA = add32(stateA, a);
    stateB = add32(stateB, b);
    stateC = add32(stateC, c);
    stateD = add32(stateD, d);
  }

  return [stateA, stateB, stateC, stateD]
    .flatMap((word) => [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, word >>> 24])
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
