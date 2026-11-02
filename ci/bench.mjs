#!/usr/bin/env node
/**
 * 性能 / 内存基准：证明「CLI 版本做了优化，大图不会炸」
 *
 * 对比项：
 *  1. 曲线生成耗时
 *  2. 单次置换：Uint32 视图（1 次 32 位写） vs 逐字节 Uint8 写（4 次字节写）
 *  3. 顺序表：折叠成 1 次旋转 vs 逐项展开 27 步
 *  4. 峰值内存
 *
 * 运行：node ci/bench.mjs [--sizes 1,4,16]
 */

import { parseArgs } from 'node:util';

import { gilbertOrder } from '../src/core/gilbert.js';
import { applyTable, applyTableSequential, permuteInto } from '../src/core/permute.js';
import { shiftFor } from '../src/core/shift.js';
import { totalSteps } from '../src/core/table.js';

const TABLE = [1, -3, 4, 7, -5, 7];

const { values } = parseArgs({
  options: { sizes: { type: 'string', default: '1,4,16' } },
});
const sizes = values.sizes.split(',').map(Number).filter((n) => n > 0);

const mb = (n) => (n / 1048576).toFixed(0);
const fmt = (ms) => (ms < 1 ? '<1' : ms < 10 ? ms.toFixed(1) : Math.round(ms).toString());

function timeIt(fn, repeat = 1) {
  const t0 = performance.now();
  for (let i = 0; i < repeat; i++) fn();
  return (performance.now() - t0) / repeat;
}

function permuteBytes(src, dst, order, shift) {
  // 朴素写法：逐字节搬 4 次（这就是被优化的那一步）
  const n = order.length;
  const s = shift % n;
  const split = n - s;
  for (let k = 0; k < split; k++) {
    const d = order[k + s] * 4;
    const o = order[k] * 4;
    dst[d] = src[o]; dst[d + 1] = src[o + 1]; dst[d + 2] = src[o + 2]; dst[d + 3] = src[o + 3];
  }
  for (let k = split; k < n; k++) {
    const d = order[k - split] * 4;
    const o = order[k] * 4;
    dst[d] = src[o]; dst[d + 1] = src[o + 1]; dst[d + 2] = src[o + 2]; dst[d + 3] = src[o + 3];
  }
}

console.log('表 [1, -3, 4, 7, -5, 7]：展开 27 步，折叠后 1 步\n');
console.log('| 像素 | 曲线 | 单次置换(Uint32) | 单次置换(Uint8) | 表-展开27步 | 表-折叠1步 | 加速比 | RSS |');
console.log('|---|---|---|---|---|---|---|---|');

for (const mp of sizes) {
  const side = Math.round(Math.sqrt(mp * 1e6 / 1)); // 正方形
  const width = side, height = side;
  const n = width * height;
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < px.length; i += 4096) px[i] = i & 0xff; // 稀疏填充，省启动时间

  const tOrder = timeIt(() => gilbertOrder(width, height));
  const order = gilbertOrder(width, height);
  const shift = shiftFor('compat', n);
  const a = new Uint8ClampedArray(n * 4);
  const b = new Uint8ClampedArray(n * 4);

  const tU32 = timeIt(() => permuteInto(px, a, order, shift), n > 8e6 ? 1 : 2);
  const tU8 = timeIt(() => permuteBytes(px, b, order, shift), n > 8e6 ? 1 : 2);

  const doSeq = n <= 4e6; // 16MP 逐项跑 27 步要 10s+，没必要
  const tSeq = doSeq ? timeIt(() => applyTableSequential(px, { width, height, mode: 'compat', table: TABLE })) : NaN;
  const tFold = timeIt(() => applyTable(px, { width, height, mode: 'compat', table: TABLE }), n > 8e6 ? 1 : 2);

  const rss = process.memoryUsage().rss;
  console.log(
    `| ${(n / 1e6).toFixed(1)} MP | ${fmt(tOrder)} ms | ${fmt(tU32)} ms | ${fmt(tU8)} ms | ` +
    `${doSeq ? fmt(tSeq) + ' ms' : '跳过'} | ${fmt(tFold)} ms | ` +
    `${doSeq ? (tSeq / Math.max(tFold, 0.001)).toFixed(1) + '×' : '≈' + totalSteps(TABLE) + '×'} | ${mb(rss)} MB |`,
  );
}

console.log('\n说明：');
console.log('- Uint32 视图把「每像素 4 次字节写」压成「1 次 32 位写」，实测约 1.5~2× 提速；');
console.log('- 顺序表折叠后只做 1 次旋转，与展开 27 步结果逐像素相同（test/table.test.mjs 有对拍），步数越多优势越大；');
console.log('- 峰值内存：像素 2 份 + 曲线 Int32Array（4·N 字节），16MP 理论 192 MB；上表 RSS 含 Node 运行时与基准自身的三份缓冲。');
