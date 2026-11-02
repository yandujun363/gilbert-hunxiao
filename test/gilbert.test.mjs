import test from 'node:test';
import assert from 'node:assert/strict';

import { gilbertOrder } from '../src/core/gilbert.js';
import { shaI32 } from './_util.mjs';

// 兼容模式（compat）的曲线回归锚点：JS 与 Python 两条实现必须算出同一串下标
const ANCHORS = {
  '8x8': '2100f2b7e3621ba5578b5f54e2895ef379699958415dac0abb4e938ce8479d61',
  '63x47': 'daa142b7150c7ca5cea52de692c99a22a9714e5ac1cd560aa6608be09919b210',
  '320x240': '55d97e67ded2b9a703c7e02a4262878892b58638e59e59b49ddac7cf9368c10a',
};

test('顺序是双射：0..N-1 各出现一次', () => {
  for (const [w, h] of [[8, 8], [1, 1], [1, 9], [9, 1], [2, 3], [3, 2], [13, 17], [37, 53], [64, 48]]) {
    const n = w * h;
    const order = gilbertOrder(w, h);
    assert.equal(order.length, n);
    const seen = new Uint8Array(n);
    for (const v of order) {
      assert.ok(v >= 0 && v < n, `${w}x${h}: 下标越界 ${v}`);
      assert.equal(seen[v], 0, `${w}x${h}: 下标重复 ${v}`);
      seen[v] = 1;
    }
  }
});

test('路径连续：相邻两点在网格上相邻（曼哈顿距离 1）', () => {
  for (const [w, h] of [[8, 8], [13, 17], [1, 9], [37, 53]]) {
    const order = gilbertOrder(w, h);
    for (let i = 1; i < order.length; i++) {
      const x1 = order[i - 1] % w, y1 = (order[i - 1] / w) | 0;
      const x2 = order[i] % w, y2 = (order[i] / w) | 0;
      assert.equal(Math.abs(x1 - x2) + Math.abs(y1 - y2), 1, `${w}x${h} 在 i=${i} 处断开`);
    }
  }
});

test('兼容模式曲线锚点（sha256）', () => {
  for (const [key, expect] of Object.entries(ANCHORS)) {
    const [w, h] = key.split('x').map(Number);
    assert.equal(shaI32(gilbertOrder(w, h)), expect, `${key} 曲线不一致`);
  }
});

test('非法尺寸快速失败', () => {
  assert.throws(() => gilbertOrder(0, 5), RangeError);
  assert.throws(() => gilbertOrder(5, -1), RangeError);
  assert.throws(() => gilbertOrder(1.5, 5), RangeError);
});
