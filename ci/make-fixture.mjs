#!/usr/bin/env node
// 生成一张测试 PNG（CI 里用）：node ci/make-fixture.mjs out.png [w] [h]
import fs from 'node:fs';

import { encodePng } from '../src/core/png.js';

const out = process.argv[2] ?? 'fixture.png';
const w = Number(process.argv[3] ?? 96);
const h = Number(process.argv[4] ?? 64);

const data = new Uint8ClampedArray(w * h * 4);
let s = 12345;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const i = (y * w + x) * 4;
    data[i] = (x * 255 / Math.max(1, w - 1)) & 0xff;
    data[i + 1] = (y * 255 / Math.max(1, h - 1)) & 0xff;
    data[i + 2] = (s >>> 24) & 0xff;
    data[i + 3] = 255;
  }
}
fs.writeFileSync(out, encodePng({ width: w, height: h, data }));
console.log(`wrote ${out} (${w}×${h})`);
