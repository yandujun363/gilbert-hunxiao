import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shiftFor, normalizeShift, parseShift, assertCustomShift, MODES, MODE_LABEL, PHI_INV,
} from '../src/core/shift.js';

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

test('custom 原样返回给定的 L，并覆盖边界 0 / N-1', () => {
  assert.equal(shiftFor('custom', 100, 37), 37);
  assert.equal(shiftFor('custom', 100, 0), 0);
  assert.equal(shiftFor('custom', 100, 99), 99);
  for (const L of [-1, 100, 1.5, NaN, Infinity, -Infinity, '5', null, undefined]) {
    assert.throws(() => shiftFor('custom', 100, L), RangeError, `应拒绝 L=${String(L)}`);
  }
});

test('custom 的 L 缺失 / 越界直接报错，绝不自动取模', () => {
  assert.throws(() => shiftFor('custom', 100), (err) => {
    assert.match(err.message, /必须是整数/);
    return true;
  });
  assert.throws(() => shiftFor('custom', 100, 100), (err) => {
    assert.match(err.message, /0 ≤ L < 100/);
    return true;
  });
  assert.equal(assertCustomShift(42, 100), 42);
});

test('parseShift 只认十进制整数', () => {
  for (const [text, expect] of [['37', 37], ['+5', 5], [' 0 ', 0], ['-3', -3]]) {
    assert.deepEqual(parseShift(text), { ok: true, shift: expect }, text);
  }
  for (const text of ['', '  ', '1.5', '1e3', '0x10', 'abc', '1 2', null, undefined]) {
    assert.equal(parseShift(text).ok, false, String(text));
  }
  assert.equal(parseShift('9007199254740992').ok, false); // 超出安全整数
});

test('MODES / MODE_LABEL 包含三种模式', () => {
  assert.deepEqual([...MODES], ['compat', 'int', 'custom']);
  for (const mode of MODES) assert.equal(typeof MODE_LABEL[mode], 'string');
});

test('normalizeShift 处理负数与超大值', () => {
  assert.equal(normalizeShift(-1, 10), 9);
  assert.equal(normalizeShift(13, 10), 3);
  assert.equal(normalizeShift(-13, 10), 7);
});

test('未知模式报错', () => {
  assert.throws(() => shiftFor('nope', 10), RangeError);
});
