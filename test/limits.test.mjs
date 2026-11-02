import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertSize, ImageTooLargeError, DEFAULT_MAX_PIXELS, DEFAULT_MAX_SIDE, formatMegapixels,
} from '../src/core/limits.js';

test('正常尺寸通过', () => {
  assert.doesNotThrow(() => assertSize(1920, 1080));
  assert.doesNotThrow(() => assertSize(4000, 4000));
});

test('超过像素上限抛 ImageTooLargeError，且消息里给出具体数字', () => {
  // 5000×4000 = 20 MP > 16 MP
  assert.throws(() => assertSize(5000, 4000), (err) => {
    assert.ok(err instanceof ImageTooLargeError);
    assert.match(err.message, /图片过大/);
    assert.match(err.message, /20\.00 MP/);
    assert.match(err.message, /上限 16\.00 MP/);
    return true;
  });
});

test('单边超限也会抛（10000×10）', () => {
  assert.throws(() => assertSize(10000, 10), (err) => {
    assert.ok(err instanceof ImageTooLargeError);
    assert.match(err.message, new RegExp(String(DEFAULT_MAX_SIDE)));
    return true;
  });
});

test('可以自定义上限', () => {
  assert.throws(() => assertSize(100, 100, { maxPixels: 5000 }), ImageTooLargeError);
  assert.doesNotThrow(() => assertSize(100, 100, { maxPixels: 50000 }));
});

test('非法尺寸与格式化', () => {
  assert.throws(() => assertSize(0, 10), RangeError);
  assert.throws(() => assertSize(10.5, 10), RangeError);
  assert.equal(formatMegapixels(307200), '0.31 MP');
  assert.equal(DEFAULT_MAX_PIXELS, 16_000_000);
});
