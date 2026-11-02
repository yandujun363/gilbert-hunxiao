import test from 'node:test';
import assert from 'node:assert/strict';

import { applyRounds, permuteInto, orderFor, clearOrderCache } from '../src/core/permute.js';
import { shiftFor } from '../src/core/shift.js';
import { diffBytes, randomPixels } from './_util.mjs';

test('单步置换可逆（多尺寸）', () => {
  for (const [w, h] of [[8, 8], [37, 53], [64, 48], [1, 9]]) {
    const n = w * h;
    const px = randomPixels(n, w + h);
    const order = orderFor(w, h);
    const L = shiftFor('compat', n);
    const enc = new Uint8ClampedArray(px.length);
    permuteInto(px, enc, order, L);
    const back = new Uint8ClampedArray(px.length);
    permuteInto(enc, back, order, L, true);
    assert.equal(diffBytes(px, back), 0, `${w}x${h}`);
    assert.ok(diffBytes(px, enc) > px.length * 0.9, `混淆后应几乎全变：${w}x${h}`);
  }
});

test('applyRounds：N 轮混淆 + N 轮解混淆 = 原样', () => {
  for (const rounds of [1, 2, 5, 13]) {
    const w = 41, h = 29, n = w * h;
    const px = randomPixels(n, rounds);
    const enc = applyRounds(px.slice(), { width: w, height: h, mode: 'compat', rounds });
    const back = applyRounds(enc.slice(), { width: w, height: h, mode: 'compat', rounds, inverse: true });
    assert.equal(diffBytes(px, back), 0, `rounds=${rounds}`);
  }
});

test('applyRounds 与逐次 applyTable 等价', async () => {
  const { applyTable } = await import('../src/core/permute.js');
  const w = 31, h = 23;
  const px = randomPixels(w * h, 3);
  for (const rounds of [1, 3, 4]) {
    const a = applyRounds(px.slice(), { width: w, height: h, mode: 'int', rounds });
    const b = applyTable(px, { width: w, height: h, mode: 'int', table: Array(rounds).fill(1) });
    assert.equal(diffBytes(a, b), 0, `rounds=${rounds}`);
  }
});

test('rounds=0 原样返回', () => {
  const px = randomPixels(64, 1);
  const out = applyRounds(px.slice(), { width: 8, height: 8, mode: 'compat', rounds: 0 });
  assert.equal(diffBytes(px, out), 0);
});

test('orderFor 有缓存且结果一致', () => {
  clearOrderCache();
  const a = orderFor(64, 48);
  const b = orderFor(64, 48);
  assert.equal(a, b);
  assert.equal(a.length, 64 * 48);
});

test('缓冲区长度不对时报错', () => {
  const order = orderFor(8, 8);
  assert.throws(() => permuteInto(new Uint8ClampedArray(10), new Uint8ClampedArray(256), order, 1), RangeError);
});
