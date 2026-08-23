/**
 * Base64 Utilities
 * Giải mã base64 -> Uint8Array (dùng cho upload chunk nhị phân và tính checksum)
 */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP: number[] = (() => {
  const table = new Array<number>(256).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    table[B64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/[\s\r\n=]+/g, '');
  const len = clean.length;
  const byteLength = Math.floor((len * 3) / 4);
  const bytes = new Uint8Array(byteLength);

  let outIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < len; i++) {
    const value = LOOKUP[clean.charCodeAt(i)];
    if (value < 0) {
      throw new Error('Invalid base64 character');
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[outIndex++] = (buffer >> bits) & 0xff;
    }
  }

  return bytes;
}
