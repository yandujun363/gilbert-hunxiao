import test from 'node:test';
import assert from 'node:assert/strict';

import { shiftFor, normalizeShift, PHI_INV } from '../src/core/shift.js';

test('φ⁻¹ 常量与 JS/Python 一致', () => {
  assert.equal(PHI_INV, 0.6180339887498949);
});

test('compat 使用 round(φ⁻¹N)（兼容模式锚点）', () => {
  const cases = [[64, 40], [2961, 1830], [76800, 47465], [308321, 190553], [307200, 189860], [921600, 569580]];
  for (const [n, expect] of cases) assert.equal(shiftFor('compat', n), expect, `N=${n}`);
});

test('int 为纯整数式 (N*618)/1000', () => {
  const cases = [[64, 39], [307200, 189849], [921600, 569548], [786432, 486014]];
  for (const [n, expect] of cases) assert.equal(shiftFor('int', n), expect, `N=${n}`);
});

test('两模式在大图上不同（所以互不兼容）', () => {
  assert.notEqual(shiftFor('compat', 921600), shiftFor('int', 921600));
});

test('normalizeShift 处理负数与超大值', () => {
  assert.equal(normalizeShift(-1, 10), 9);
  assert.equal(normalizeShift(13, 10), 3);
  assert.equal(normalizeShift(-13, 10), 7);
});

test('未知模式报错', () => {
  assert.throws(() => shiftFor('nope', 10), RangeError);
});
