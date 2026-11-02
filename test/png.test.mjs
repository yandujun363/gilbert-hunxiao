import test from 'node:test';
import assert from 'node:assert/strict';

import { decodePng, encodePng, isPng, readPngInfo } from '../src/core/png.js';
import { diffBytes, randomPixels } from './_util.mjs';

// 由 Pillow 生成的小夹具（RGB / 灰度 / 调色板），覆盖不同的行滤波与色彩类型
const FIXTURES = {
  rgb: {
    b64: 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAJElEQVR42mP4z8DA8J+BgeH///8MjFwicnDAABFsaGhgP8ELANhEC6Cr7JkcAAAAAElFTkSuQmCC',
    rgba: [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
      10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
      0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 7, 200, 13, 255],
  },
  gray: {
    b64: 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAAAAACRn/EaAAAAF0lEQVR42mPwmSb7iFFITk6O+fvzW8wAImAFDeS/tU4AAAAASUVORK5CYII=',
    rgba: [76, 76, 76, 255, 150, 150, 150, 255, 29, 29, 29, 255, 226, 226, 226, 255,
      18, 18, 18, 255, 48, 48, 48, 255, 78, 78, 78, 255, 108, 108, 108, 255,
      0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 121, 121, 121, 255],
  },
  pal: {
    b64: 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADAgMAAADJmkZVAAAADFBMVEWB8UNjanFmFx4AAIDMgs7CAAAADklEQVR42mPoYZJkug8AA/gBidgyqCcAAAAASUVORK5CYII=',
    rgba: [102, 23, 30, 255, 129, 241, 67, 255, 0, 0, 128, 255, 129, 241, 67, 255,
      102, 23, 30, 255, 102, 23, 30, 255, 99, 106, 113, 255, 99, 106, 113, 255,
      102, 23, 30, 255, 129, 241, 67, 255, 99, 106, 113, 255, 129, 241, 67, 255],
  },
};

for (const [name, fx] of Object.entries(FIXTURES)) {
  test(`解码 ${name} PNG（4×3）逐像素正确`, () => {
    const buf = Buffer.from(fx.b64, 'base64');
    assert.ok(isPng(buf));
    const img = decodePng(buf);
    assert.equal(img.width, 4);
    assert.equal(img.height, 3);
    assert.deepEqual(Array.from(img.data), fx.rgba);
  });
}

test('rgba 编码 → 解码 逐字节往返', () => {
  const w = 37, h = 23;
  const px = randomPixels(w * h, 7);
  const buf = encodePng({ width: w, height: h, data: px });
  const back = decodePng(buf);
  assert.equal(back.width, w);
  assert.equal(back.height, h);
  assert.equal(diffBytes(px, back.data), 0);
});

test('readPngInfo 不 inflate 就能拿到尺寸（用于超大图提前拦截）', () => {
  const buf = encodePng({ width: 123, height: 45, data: new Uint8ClampedArray(123 * 45 * 4) });
  const info = readPngInfo(buf);
  assert.equal(info.width, 123);
  assert.equal(info.height, 45);
  assert.equal(info.bitDepth, 8);
  assert.equal(info.colorType, 6);
});

test('非 PNG / 截断 / 数据长度不对 都会报错', () => {
  assert.throws(() => decodePng(Buffer.from('not a png')), /不是 PNG/);
  const good = encodePng({ width: 4, height: 4, data: new Uint8ClampedArray(64) });
  assert.throws(() => decodePng(good.subarray(0, 20)), /截断/);
  assert.throws(() => encodePng({ width: 4, height: 4, data: new Uint8ClampedArray(10) }), RangeError);
});
