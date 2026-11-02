#!/usr/bin/env node
/**
 * CLI / 无头版本（no DOM, no canvas, no 三方依赖）
 *
 * 前端靠 canvas 解码显示；这里完全绕开浏览器：直接读写 PNG，像素在内存里置换，
 * 全程无损、不经过任何有损编码器 —— 所以不会有「包浆」。
 *
 * 用法：
 *   node ci/cli.mjs encode in.png out.png --mode compat --rounds 3
 *   node ci/cli.mjs encode in.png out.png --table "[1,-3,4,7,-5,7]"
 *   node ci/cli.mjs decode in.png out.png --table "[1,-3,4,7,-5,7]"
 *   node ci/cli.mjs gen-table --length 8 --range 8
 *   node ci/cli.mjs info in.png
 *   node ci/cli.mjs selftest
 */

import fs from 'node:fs';
import { parseArgs } from 'node:util';

import { gilbertOrder } from '../src/core/gilbert.js';
import { assertSize, DEFAULT_MAX_PIXELS, DEFAULT_MAX_SIDE } from '../src/core/limits.js';
import { applyRounds, applyTable, applyTableSequential, tableShift } from '../src/core/permute.js';
import { decodePng, encodePng, readPngInfo } from '../src/core/png.js';
import { shiftFor, MODES } from '../src/core/shift.js';
import {
  generateTable, parseTable, formatTable, netSteps, totalSteps, describeTable,
} from '../src/core/table.js';

const USAGE = `用法: node ci/cli.mjs <command> [...]

命令:
  encode <in.png> <out.png>     混淆（可用 --rounds 或 --table）
  decode <in.png> <out.png>     解混淆（--table 时自动倒表取反）
  gen-table                     生成随机顺序表
  info <in.png>                 看尺寸 / 两种模式的位移 / 表折叠后的净位移
  selftest                      内置自检

通用参数:
  --mode compat|int     取整规则（compat=兼容浮点取整，int=纯整数；默认 compat）
  --rounds N            连续置换 N 轮
  --table "T"           顺序表，如 "[1,-3,4,7,-5,7]"
  --max-mp N            像素上限（百万），默认 ${DEFAULT_MAX_PIXELS / 1e6}
  --json                机器可读输出`;

function fail(msg, code = 1) {
  process.stderr.write(`错误: ${msg}\n`);
  process.exit(code);
}

function parseTableArg(raw) {
  const parsed = parseTable(raw);
  if (!parsed.ok) fail(`编码表解析失败：${parsed.error}`);
  return parsed.table;
}

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      mode: { type: 'string', default: 'compat' },
      rounds: { type: 'string' },
      table: { type: 'string' },
      'max-mp': { type: 'string' },
      length: { type: 'string' },
      range: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const cmd = positionals[0];
  if (values.help || !cmd) {
    process.stdout.write(USAGE + '\n');
    process.exit(values.help ? 0 : 2);
  }
  if (!MODES.includes(values.mode)) fail(`--mode 只能是 ${MODES.join(' / ')}`, 2);

  switch (cmd) {
    case 'encode':
    case 'decode':
      return runTransform(cmd, positionals.slice(1), values);
    case 'gen-table':
      return runGenTable(values);
    case 'info':
      return runInfo(positionals[1], values);
    case 'selftest':
      return runSelftest();
    default:
      fail(`未知命令: ${cmd}`, 2);
  }
}

function limitsFrom(values) {
  const mp = values['max-mp'] === undefined ? DEFAULT_MAX_PIXELS / 1e6 : Number(values['max-mp']);
  if (!Number.isFinite(mp) || mp <= 0) fail('--max-mp 必须是正数', 2);
  return { maxPixels: Math.round(mp * 1e6), maxSide: DEFAULT_MAX_SIDE };
}

function runTransform(cmd, args, values) {
  const inverse = cmd === 'decode';
  const [input, output] = args;
  if (!input || !output) fail(`${cmd} 需要 <输入.png> <输出.png>`, 2);
  if (values.table && values.rounds !== undefined) fail('--table 与 --rounds 只能二选一', 2);

  const table = values.table === undefined ? null : parseTableArg(values.table);
  const rounds = values.rounds === undefined ? 1 : Number(values.rounds);
  if (!table && (!Number.isInteger(rounds) || rounds < 0)) fail('--rounds 必须是非负整数', 2);

  const limits = limitsFrom(values);
  const buf = fs.readFileSync(input);

  // 先只看 IHDR：超大图在 inflate 之前就挡掉，避免内存爆炸
  const info = readPngInfo(buf);
  try {
    assertSize(info.width, info.height, limits);
  } catch (err) {
    fail(err.message);
  }

  const t0 = performance.now();
  const { width, height, data } = decodePng(buf);
  const t1 = performance.now();

  let pixels;
  let steps;
  if (table) {
    pixels = applyTable(data, { width, height, mode: values.mode, table, inverse });
    steps = totalSteps(table);
  } else {
    pixels = applyRounds(data, { width, height, mode: values.mode, rounds, inverse });
    steps = rounds;
  }
  const t2 = performance.now();

  fs.writeFileSync(output, encodePng({ width, height, data: pixels }));
  const t3 = performance.now();

  const n = width * height;
  const report = {
    command: cmd,
    mode: values.mode,
    width,
    height,
    megapixels: +(n / 1e6).toFixed(3),
    table: table ? formatTable(table) : null,
    rounds: table ? null : rounds,
    steps,
    singleShift: shiftFor(values.mode, n),
    netShift: table ? tableShift(n, values.mode, table, inverse) : null,
    ms: { decode: +(t1 - t0).toFixed(1), permute: +(t2 - t1).toFixed(1), encode: +(t3 - t2).toFixed(1) },
    rssMB: +(process.memoryUsage().rss / 1048576).toFixed(0),
  };

  if (values.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  process.stdout.write(
    `✔ ${cmd === 'encode' ? '编码' : '解码'}完成  ${width}×${height} (${report.megapixels} MP)  mode=${report.mode}\n` +
    `  位移 L=${report.singleShift}${table ? `  表 ${report.table}（展开 ${steps} 步 → 折叠为 1 次旋转，净位移 ${report.netShift}）` : `  轮数=${rounds}`}\n` +
    `  耗时 解码 ${report.ms.decode}ms · 置换 ${report.ms.permute}ms · 编码 ${report.ms.encode}ms   RSS ${report.rssMB} MB\n` +
    `  → ${output}\n`,
  );
}

function runGenTable(values) {
  const length = values.length === undefined ? 8 : Number(values.length);
  const range = values.range === undefined ? 8 : Number(values.range);
  let table;
  try {
    table = generateTable({ length, range });
  } catch (err) {
    fail(err.message, 2);
  }
  if (values.json) {
    process.stdout.write(JSON.stringify({ table, netSteps: netSteps(table), steps: totalSteps(table) }) + '\n');
    return;
  }
  process.stdout.write(`${formatTable(table)}\n`);
  process.stdout.write(`  ${describeTable(table)}\n`);
  process.stdout.write(`  净位移 ${netSteps(table)} 次 · 展开 ${totalSteps(table)} 步\n`);
}

function runInfo(input, values) {
  if (!input) fail('info 需要 <输入.png>', 2);
  const buf = fs.readFileSync(input);
  const info = readPngInfo(buf);
  const n = info.width * info.height;
  let table = null;
  if (values.table !== undefined) table = parseTableArg(values.table);
  const out = {
    file: input,
    width: info.width,
    height: info.height,
    megapixels: +(n / 1e6).toFixed(3),
    bitDepth: info.bitDepth,
    colorType: info.colorType,
    shifts: { compat: shiftFor('compat', n), int: shiftFor('int', n) },
  };
  if (table) {
    out.table = formatTable(table);
    out.steps = totalSteps(table);
    out.netSteps = netSteps(table);
    out.netShift = tableShift(n, values.mode, table, false);
    out.netShiftInverse = tableShift(n, values.mode, table, true);
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

function runSelftest() {
  const sizes = [[8, 8], [13, 17], [64, 48], [1, 9], [37, 53]];
  let failed = 0;
  const check = (name, cond) => {
    process.stdout.write(`  ${cond ? 'PASS' : 'FAIL'}  ${name}\n`);
    if (!cond) failed++;
  };

  for (const [w, h] of sizes) {
    const n = w * h;
    const order = gilbertOrder(w, h);
    const sorted = Int32Array.from(order).sort();
    let bijective = sorted.length === n;
    for (let i = 0; i < n && bijective; i++) if (sorted[i] !== i) bijective = false;
    let continuous = true;
    for (let i = 1; i < n; i++) {
      const x1 = order[i - 1] % w, y1 = (order[i - 1] / w) | 0;
      const x2 = order[i] % w, y2 = (order[i] / w) | 0;
      if (Math.abs(x1 - x2) + Math.abs(y1 - y2) !== 1) { continuous = false; break; }
    }
    check(`${w}×${h} Gilbert 双射+连续`, bijective && continuous);
  }

  const w = 37, h = 53, n = w * h;
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < px.length; i++) px[i] = (i * 37 + 11) & 0xff;
  const table = [1, -3, 4, 7, -5, 7];

  const enc = applyTable(px, { width: w, height: h, mode: 'compat', table });
  const back = applyTable(enc, { width: w, height: h, mode: 'compat', table, inverse: true });
  let diff = 0;
  for (let i = 0; i < px.length; i++) if (px[i] !== back[i]) diff++;
  check('顺序表编码→解码 逐字节还原', diff === 0);

  const seq = applyTableSequential(px, { width: w, height: h, mode: 'compat', table });
  let diff2 = 0;
  for (let i = 0; i < px.length; i++) if (enc[i] !== seq[i]) diff2++;
  check('折叠 1 次 == 逐项展开 27 步', diff2 === 0);

  process.stdout.write(failed ? `\n${failed} 项失败\n` : '\n全部通过\n');
  process.exit(failed ? 1 : 0);
}

try {
  main(process.argv.slice(2));
} catch (err) {
  fail(err && err.message ? err.message : String(err));
}
