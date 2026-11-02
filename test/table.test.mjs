import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTable, formatTable, invertTable, netSteps, totalSteps, generateTable, describeTable,
} from '../src/core/table.js';
import { applyTable, applyTableSequential, tableShift } from '../src/core/permute.js';
import { diffBytes, randomPixels } from './_util.mjs';

test('解析：JSON 数组 / 空格 / 逗号 / 中文顿号', () => {
  for (const text of ['[1, -3, 4, 7, -5, 7]', '1 -3 4 7 -5 7', '1, -3, 4, 7, -5, 7', '1、-3、4、7、-5、7']) {
    const r = parseTable(text);
    assert.ok(r.ok, text);
    assert.deepEqual(r.table, [1, -3, 4, 7, -5, 7]);
  }
});

test('解析：拒绝空表 / 小数 / 越界 / 非数字', () => {
  assert.equal(parseTable('').ok, false);
  assert.equal(parseTable('[1.5, 2]').ok, false);
  assert.equal(parseTable('[1, 999]').ok, false);
  assert.equal(parseTable('abc').ok, false);
});

test('invertTable：倒着取且逐项取反（[1,-3] → [3,-1]）', () => {
  assert.deepEqual(invertTable([1, -3]), [3, -1]);
  assert.deepEqual(invertTable([1, -3, 4, 7, -5, 7]), [-7, 5, -7, -4, 3, -1]);
  assert.equal(netSteps(invertTable([1, -3, 4, 7, -5, 7])), -netSteps([1, -3, 4, 7, -5, 7]));
});

test('净位移与展开步数', () => {
  const t = [1, -3, 4, 7, -5, 7];
  assert.equal(netSteps(t), 11);
  assert.equal(totalSteps(t), 27);
  assert.equal(describeTable([1, -3]), '正向 1 → 反向 3');
});

test('折叠成一次旋转 == 逐项展开（多种尺寸/模式/表）', () => {
  const tables = [[1, -3, 4, 7, -5, 7], [2, 2, 2], [-1], [8, -8, 8, -8], [3, -2, 9]];
  for (const [w, h] of [[37, 53], [8, 8], [64, 48], [13, 17]]) {
    const px = randomPixels(w * h, w * 7 + h);
    for (const mode of ['compat', 'int']) {
      for (const table of tables) {
        const fast = applyTable(px, { width: w, height: h, mode, table });
        const slow = applyTableSequential(px, { width: w, height: h, mode, table });
        assert.equal(diffBytes(fast, slow), 0, `${w}x${h} ${mode} ${formatTable(table)}`);
      }
    }
  }
});

test('表编码 → 表解码 = 逐字节还原（含随机表）', () => {
  const px = randomPixels(41 * 29, 99);
  for (const table of [[1, -3, 4, 7, -5, 7], generateTable({ length: 8, range: 8 })]) {
    for (const mode of ['compat', 'int']) {
      const enc = applyTable(px, { width: 41, height: 29, mode, table });
      const back = applyTable(enc, { width: 41, height: 29, mode, table, inverse: true });
      assert.equal(diffBytes(px, back), 0, `${mode} ${formatTable(table)}`);
    }
  }
});

test('多解一次会重新打乱（有且只有一次是对的）', () => {
  const px = randomPixels(23 * 19, 5);
  const table = [2, -1];
  const enc = applyTable(px, { width: 23, height: 19, mode: 'compat', table });
  const dec1 = applyTable(enc, { width: 23, height: 19, mode: 'compat', table, inverse: true });
  const dec2 = applyTable(dec1, { width: 23, height: 19, mode: 'compat', table, inverse: true });
  assert.equal(diffBytes(px, dec1), 0);
  assert.ok(diffBytes(px, dec2) > px.length * 0.9);
});

test('tableShift 与直接旋转一致', () => {
  const n = 64 * 48, table = [1, -3, 4, 7, -5, 7];
  const s = tableShift(n, 'compat', table);
  assert.equal(typeof s, 'number');
  assert.ok(s >= 0 && s < n);
  const inv = tableShift(n, 'compat', table, true);
  assert.equal((s + inv) % n, 0);
});

test('生成表：默认 8 项、取值在 ±8、不含 0', () => {
  for (let i = 0; i < 50; i++) {
    const t = generateTable();
    assert.equal(t.length, 8);
    for (const v of t) {
      assert.ok(Number.isInteger(v) && v !== 0 && Math.abs(v) <= 8, `非法表项 ${v}`);
    }
  }
});

test('生成表：自定义长度/范围，且拒绝非法参数', () => {
  const t = generateTable({ length: 32, range: 3 });
  assert.equal(t.length, 32);
  for (const v of t) assert.ok(Math.abs(v) <= 3);
  assert.throws(() => generateTable({ length: 0 }), RangeError);
  assert.throws(() => generateTable({ range: 0 }), RangeError);
  assert.throws(() => generateTable({ length: 9999 }), RangeError);
});
