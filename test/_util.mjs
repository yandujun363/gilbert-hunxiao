import { createHash } from 'node:crypto';

export function shaI32(arr) {
  const b = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) b.writeInt32LE(arr[i], i * 4);
  return createHash('sha256').update(b).digest('hex');
}

export function randomPixels(n, seed = 1) {
  const px = new Uint8ClampedArray(n * 4);
  let s = seed >>> 0;
  for (let i = 0; i < px.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    px[i] = (s >>> 24) & 0xff;
  }
  return px;
}

export function diffBytes(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}
