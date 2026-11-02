import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { decodePng, encodePng } from '../src/core/png.js';
import { applyTable, applyRounds } from '../src/core/permute.js';
import { diffBytes, randomPixels } from './_util.mjs';

const PY = process.env.PYTHON ?? 'python3';
const CLI = path.resolve(import.meta.dirname, '../ci/py/gilbert_cli.py');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gilbert-py-'));

function pythonAvailable() {
  const r = spawnSync(PY, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
  return r.status === 0;
}

function runPy(args) {
  const r = spawnSync(PY, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `python 失败: ${r.stderr}`);
  return r.stdout;
}

const SKIP = !pythonAvailable();
const TABLE = [1, -3, 4, 7, -5, 7];

test('Python 版与 JS 版：顺序表编码产物逐字节相同', { skip: SKIP && '没有 python3' }, () => {
  const w = 61, h = 47;
  const px = randomPixels(w * h, 21);
  const input = path.join(tmp, 'in.png');
  const out = path.join(tmp, 'py-enc.png');
  fs.writeFileSync(input, encodePng({ width: w, height: h, data: px }));

  runPy(['encode', input, out, '--table', JSON.stringify(TABLE), '--mode', 'compat']);

  const pyPixels = decodePng(fs.readFileSync(out)).data;
  const jsPixels = applyTable(px, { width: w, height: h, mode: 'compat', table: TABLE });
  assert.equal(diffBytes(pyPixels, jsPixels), 0);
});

test('Python 版与 JS 版：多轮产物逐字节相同（整数模式）', { skip: SKIP && '没有 python3' }, () => {
  const w = 53, h = 40;
  const px = randomPixels(w * h, 22);
  const input = path.join(tmp, 'in2.png');
  const out = path.join(tmp, 'py-enc2.png');
  fs.writeFileSync(input, encodePng({ width: w, height: h, data: px }));

  runPy(['encode', input, out, '--rounds', '3', '--mode', 'int']);

  const pyPixels = decodePng(fs.readFileSync(out)).data;
  const jsPixels = applyRounds(px, { width: w, height: h, mode: 'int', rounds: 3 });
  assert.equal(diffBytes(pyPixels, jsPixels), 0);
});

test('Python 版 encode → decode 往返逐字节一致', { skip: SKIP && '没有 python3' }, () => {
  const w = 37, h = 29;
  const px = randomPixels(w * h, 23);
  const input = path.join(tmp, 'in3.png');
  const enc = path.join(tmp, 'py-a.png');
  const back = path.join(tmp, 'py-b.png');
  fs.writeFileSync(input, encodePng({ width: w, height: h, data: px }));

  runPy(['encode', input, enc, '--table', '[1,-3,4]']);
  runPy(['decode', enc, back, '--table', '[1,-3,4]']);

  assert.equal(diffBytes(px, decodePng(fs.readFileSync(back)).data), 0);
});

test('Python 版 selftest 通过', { skip: SKIP && '没有 python3' }, () => {
  const out = runPy(['selftest']);
  assert.match(out, /全部通过/);
});

test('Python 版与 JS 版：custom L 产物逐字节相同', { skip: SKIP && '没有 python3' }, () => {
  const w = 61, h = 47;
  const px = randomPixels(w * h, 24);
  const input = path.join(tmp, 'cu_in.png');
  const out = path.join(tmp, 'cu_enc.png');
  fs.writeFileSync(input, encodePng({ width: w, height: h, data: px }));

  runPy(['encode', input, out, '--mode', 'custom', '--shift', '777']);
  const pyPixels = decodePng(fs.readFileSync(out)).data;
  const jsPixels = applyRounds(px, { width: w, height: h, mode: 'custom', shift: 777, rounds: 1 });
  assert.equal(diffBytes(pyPixels, jsPixels), 0);
});

test('Python 版与 JS 版：custom L + 顺序表产物逐字节相同', { skip: SKIP && '没有 python3' }, () => {
  const w = 53, h = 40;
  const px = randomPixels(w * h, 25);
  const input = path.join(tmp, 'cu2_in.png');
  const out = path.join(tmp, 'cu2_enc.png');
  fs.writeFileSync(input, encodePng({ width: w, height: h, data: px }));

  runPy(['encode', input, out, '--mode', 'custom', '--shift', '123', '--table', JSON.stringify(TABLE)]);
  const pyPixels = decodePng(fs.readFileSync(out)).data;
  const jsPixels = applyTable(px, {
    width: w, height: h, mode: 'custom', shift: 123, table: TABLE,
  });
  assert.equal(diffBytes(pyPixels, jsPixels), 0);
});

test('Python 版拒绝越界的 custom L（退出码 2）', { skip: SKIP && '没有 python3' }, () => {
  const w = 20, h = 20;
  const input = path.join(tmp, 'cu3_in.png');
  fs.writeFileSync(input, encodePng({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }));
  const r = spawnSync(PY, [CLI, 'encode', input, path.join(tmp, 'cu3_x.png'),
    '--mode', 'custom', '--shift', '400'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /0 ≤ L < 400/);
});
