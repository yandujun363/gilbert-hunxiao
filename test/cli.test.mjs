import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { decodePng, encodePng } from '../src/core/png.js';
import { diffBytes, randomPixels } from './_util.mjs';

const CLI = path.resolve(import.meta.dirname, '../ci/cli.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gilbert-cli-'));

function run(args, opts = {}) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts });
}

test('encode → decode 往返逐字节一致（--rounds）', () => {
  const w = 61, h = 47;
  const px = randomPixels(w * h, 11);
  const input = path.join(tmp, 'in.png');
  const enc = path.join(tmp, 'enc.png');
  const back = path.join(tmp, 'back.png');
  fs.writeFileSync(input, encodePng({ width: w, height: h, data: px }));

  run(['encode', input, enc, '--rounds', '2']);
  run(['decode', enc, back, '--rounds', '2']);

  const decoded = decodePng(fs.readFileSync(back));
  assert.equal(diffBytes(px, decoded.data), 0);
});

test('encode → decode 往返逐字节一致（--table）', () => {
  const w = 53, h = 40;
  const px = randomPixels(w * h, 12);
  const input = path.join(tmp, 't_in.png');
  const enc = path.join(tmp, 't_enc.png');
  const back = path.join(tmp, 't_back.png');
  fs.writeFileSync(input, encodePng({ width: w, height: h, data: px }));

  const out = run(['encode', input, enc, '--table', '[1,-3,4,7,-5,7]']);
  assert.match(out, /展开 27 步/);
  run(['decode', enc, back, '--table', '[1,-3,4,7,-5,7]']);

  const decoded = decodePng(fs.readFileSync(back));
  assert.equal(diffBytes(px, decoded.data), 0);
});

test('编码会真的改变像素（不是空转）', () => {
  const w = 32, h = 32;
  const px = randomPixels(w * h, 13);
  const input = path.join(tmp, 'c_in.png');
  const enc = path.join(tmp, 'c_enc.png');
  fs.writeFileSync(input, encodePng({ width: w, height: h, data: px }));
  run(['encode', input, enc]);
  const decoded = decodePng(fs.readFileSync(enc));
  assert.ok(diffBytes(px, decoded.data) > px.length * 0.9);
});

test('超大图直接报错（不 inflate，退出码 1）', () => {
  const w = 200, h = 200;
  const input = path.join(tmp, 'big.png');
  fs.writeFileSync(input, encodePng({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }));
  assert.throws(() => run(['encode', input, path.join(tmp, 'x.png'), '--max-mp', '0.01'], { stdio: 'pipe' }), (err) => {
    assert.equal(err.status, 1);
    assert.match(String(err.stderr), /图片过大/);
    return true;
  });
});

test('gen-table 输出可被重新解析', () => {
  const out = run(['gen-table', '--length', '10', '--range', '5', '--json']);
  const obj = JSON.parse(out);
  assert.equal(obj.table.length, 10);
  for (const v of obj.table) assert.ok(Math.abs(v) <= 5 && v !== 0);
  const out2 = run(['gen-table']);
  assert.match(out2, /^\[-?\d/);
});

test('--table 与 --rounds 互斥', () => {
  assert.throws(() => run(['encode', 'a.png', 'b.png', '--table', '[1]', '--rounds', '2'], { stdio: 'pipe' }), (err) => {
    assert.match(String(err.stderr), /二选一/);
    return true;
  });
});

test('custom 模式：--shift 往返逐字节一致', () => {
  const w = 61, h = 47;
  const px = randomPixels(w * h, 14);
  const input = path.join(tmp, 'cu_in.png');
  const enc = path.join(tmp, 'cu_enc.png');
  const back = path.join(tmp, 'cu_back.png');
  fs.writeFileSync(input, encodePng({ width: w, height: h, data: px }));

  const out = run(['encode', input, enc, '--mode', 'custom', '--shift', '777']);
  assert.match(out, /mode=custom/);
  assert.match(out, /L=777/);
  assert.ok(diffBytes(px, decodePng(fs.readFileSync(enc)).data) > px.length * 0.9, '应真的打乱');
  run(['decode', enc, back, '--mode', 'custom', '--shift', '777']);

  assert.equal(diffBytes(px, decodePng(fs.readFileSync(back)).data), 0);
});

test('custom 模式：L 越界 / 缺失 / 与非 custom 混用都报错', () => {
  const w = 20, h = 20;
  const input = path.join(tmp, 'cu_bad.png');
  fs.writeFileSync(input, encodePng({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }));
  const out = path.join(tmp, 'cu_x.png');

  for (const args of [
    ['encode', input, out, '--mode', 'custom'],                       // 缺 --shift
    ['encode', input, out, '--mode', 'custom', '--shift', '400'],     // L = N
    ['encode', input, out, '--mode', 'custom', '--shift=-1'],          // 负数（写成 = 形式交给解析器）
    ['encode', input, out, '--mode', 'custom', '--shift', '1.5'],     // 非整数
    ['encode', input, out, '--shift', '3'],                           // 没开 custom
  ]) {
    assert.throws(() => run(args, { stdio: 'pipe' }), (err) => err.status === 2, args.join(' '));
  }
});

test('info 能显示 custom 的 L', () => {
  const w = 20, h = 20;
  const input = path.join(tmp, 'cu_info.png');
  fs.writeFileSync(input, encodePng({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }));
  const obj = JSON.parse(run(['info', input, '--mode', 'custom', '--shift', '13']));
  assert.equal(obj.shifts.custom, 13);
  assert.equal(obj.shifts.compat, 247);
});
