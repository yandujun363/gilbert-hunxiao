/**
 * 前端主程序
 *
 * 设计要点（这就是「不包浆」的原因）：
 *  - 解码只发生在「载入」这一下（createImageBitmap + getImageData）；
 *  - 之后所有混淆/解混淆都只是对内存里 Uint8ClampedArray 做置换；
 *  - 显示走 canvas.putImageData（原始像素直贴，不经过任何编码器）；
 *  - 只有点「下载」时才编码一次，PNG 无损、JPEG 由用户显式选择质量。
 */

import { applyRounds, applyTable, tableShift } from '../core/permute.js';
import { shiftFor, assertCustomShift, parseShift } from '../core/shift.js';
import { assertSize, DEFAULT_MAX_PIXELS, DEFAULT_MAX_SIDE } from '../core/limits.js';
import {
  parseTable, formatTable, generateTable, invertTable, netSteps, totalSteps, describeTable,
} from '../core/table.js';

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const els = {
  dropzone: $('dropzone'),
  display: /** @type {HTMLCanvasElement} */ ($('display')),
  file: /** @type {HTMLInputElement} */ ($('file')),
  limitHint: $('limit-hint'),
  toast: $('toast'),
  mode: /** @type {HTMLSelectElement} */ ($('mode')),
  customShiftBox: $('custom-shift-box'),
  customShift: /** @type {HTMLInputElement} */ ($('custom-shift')),
  customShiftError: $('custom-shift-error'),
  table: /** @type {HTMLTextAreaElement} */ ($('table')),
  tableError: $('table-error'),
  tableDesc: $('table-desc'),
  genLength: /** @type {HTMLInputElement} */ ($('gen-length')),
  genRange: /** @type {HTMLInputElement} */ ($('gen-range')),
  maxMp: /** @type {HTMLInputElement} */ ($('max-mp')),
  jpgQuality: /** @type {HTMLInputElement} */ ($('jpg-quality')),
  statSize: $('stat-size'),
  statMp: $('stat-mp'),
  statShift: $('stat-shift'),
  statOps: $('stat-ops'),
  statDiff: $('stat-diff'),
  statSteps: $('stat-steps'),
  statNetShift: $('stat-netshift'),
  statInvTable: $('stat-invtable'),
  chipOps: $('chip-ops'),
};

const state = {
  width: 0,
  height: 0,
  /** @type {Uint8ClampedArray|null} */ data: null,
  /** @type {Uint8ClampedArray|null} */ original: null,
  /** 第二个缓冲：乒乓用，避免每次点击都分配几十 MB @type {Uint8ClampedArray|null} */
  spare: null,
  name: 'image',
  ops: 0,
  steps: 0,
};

const hasImage = () => state.data !== null;

function limits() {
  const mp = Number(els.maxMp.value);
  const maxPixels = Number.isFinite(mp) && mp > 0 ? Math.round(mp * 1e6) : DEFAULT_MAX_PIXELS;
  return { maxPixels, maxSide: DEFAULT_MAX_SIDE };
}

let toastTimer = 0;
function toast(message, ok = false) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  els.toast.classList.toggle('ok', ok);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, ok ? 2200 : 6000);
}

/* ------------------------------------------------------------------ 自定义 L */

/**
 * 当前模式下这张图的 L。custom 模式会严格解析并校验 0 ≤ L < N。
 * @param {number} n 像素总数
 * @returns {{ok: true, shift: number} | {ok: false, error: string}}
 */
function shiftForImage(n) {
  if (state.mode !== 'custom') return { ok: true, shift: shiftFor(state.mode, n) };
  const parsed = parseShift(els.customShift.value);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  try {
    return { ok: true, shift: assertCustomShift(parsed.shift, n) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function updateCustomShiftUI() {
  const custom = state.mode === 'custom';
  els.customShiftBox.hidden = !custom;
  if (!custom) {
    els.customShiftError.hidden = true;
    return;
  }
  const n = state.width * state.height;
  if (n > 0) els.customShift.max = String(n - 1);
  if (!hasImage()) {
    els.customShiftError.hidden = true;
    return;
  }
  const res = shiftForImage(n);
  els.customShiftError.hidden = res.ok;
  if (!res.ok) els.customShiftError.textContent = res.error;
}

/* ------------------------------------------------------------------ 渲染 */

function render() {
  const { width, height, data } = state;
  if (!data) return;
  els.display.width = width;
  els.display.height = height;
  const ctx = els.display.getContext('2d', { alpha: true });
  // 关键：直接放原始像素，不经过 toBlob/toDataURL，不触发任何有损编码
  ctx.putImageData(new ImageData(data, width, height), 0, 0);
  els.display.hidden = false;
  els.dropzone.hidden = true;
}

/* ------------------------------------------------------------------ 统计 */

function psnr(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  const mse = sum / a.length;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

function updateDiff() {
  if (!state.original) {
    els.statDiff.textContent = '—';
    return;
  }
  let changed = 0;
  const a = state.data, b = state.original;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
  if (changed === 0) {
    els.statDiff.textContent = '逐像素相同（0 字节差异）';
    els.statDiff.className = 'stat-ok';
  } else {
    const p = psnr(a, b);
    els.statDiff.textContent = `${(100 * changed / a.length).toFixed(1)}% 不同 · ${p.toFixed(1)} dB`;
    els.statDiff.className = 'stat-bad';
  }
}

function updateStats() {
  const { width, height, data } = state;
  if (!data) {
    els.chipOps.textContent = '未载入';
    return;
  }
  const n = width * height;
  els.statSize.textContent = `${width}×${height}`;
  els.statMp.textContent = `${(n / 1e6).toFixed(2)} MP`;
  const shiftRes = shiftForImage(n);
  els.statShift.textContent = shiftRes.ok ? String(shiftRes.shift) : 'L 非法';
  els.statOps.textContent = state.ops ? `${state.ops} 次（${state.steps} 步）` : '0';
  els.chipOps.textContent = `${width}×${height} · ${state.ops} 次操作`;
  updateDiff();
}

/* ------------------------------------------------------------------ 顺序表 */

function currentTable() {
  const parsed = parseTable(els.table.value);
  if (!parsed.ok) {
    els.tableError.textContent = parsed.error;
    els.tableError.className = 'note error';
    return null;
  }
  els.tableError.textContent = '';
  els.tableError.className = 'note';
  return parsed.table;
}

function updateTableStats() {
  const table = currentTable();
  if (!table) {
    els.statSteps.textContent = '—';
    els.statNetShift.textContent = '—';
    els.statInvTable.textContent = '—';
    els.tableDesc.textContent = '编码表解析失败';
    return;
  }
  els.statSteps.textContent = `${totalSteps(table)} 步`;
  els.tableDesc.textContent = describeTable(table);
  els.statInvTable.textContent = formatTable(invertTable(table));
  if (hasImage()) {
    const n = state.width * state.height;
    const net = netSteps(table);
    const shiftRes = shiftForImage(n);
    els.statNetShift.textContent = shiftRes.ok
      ? `${net} × L = ${tableShift(n, state.mode, table, false, shiftRes.shift)} px`
      : `${net} × L（L 非法）`;
  } else {
    els.statNetShift.textContent = `${netSteps(table)} × L`;
  }
}

/* ------------------------------------------------------------------ 载入 */

function setImage({ width, height, data, name }) {
  try {
    assertSize(width, height, limits());
  } catch (err) {
    toast(err.message);
    return false;
  }
  state.width = width;
  state.height = height;
  state.data = data;
  state.original = data.slice();
  state.spare = new Uint8ClampedArray(data.length);
  state.name = name || 'image';
  state.ops = 0;
  state.steps = 0;
  render();
  updateCustomShiftUI();
  updateStats();
  updateTableStats();
  setBusy(false); // 有图了，放开按钮
  const mp = (width * height) / 1e6;
  toast(`已载入 ${name || '图片'}：${width}×${height}（${mp.toFixed(2)} MP）`, true);
  return true;
}

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    toast('这不是图片文件');
    return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close?.();
    setImage({ width: imageData.width, height: imageData.height, data: imageData.data, name: file.name });
  } catch (err) {
    toast(`解码失败：${err.message || err}`);
  }
}

/* ------------------------------------------------------------------ 操作 */

function setBusy(busy) {
  for (const id of ['enc', 'dec', 'apply-enc', 'apply-dec', 'restore', 'sample', 'pick',
    'download-png', 'download-jpg']) {
    const el = /** @type {HTMLButtonElement} */ ($(id));
    if (el) el.disabled = busy || (id !== 'sample' && id !== 'pick' && !hasImage());
  }
}

function runRounds(inverse) {
  if (!hasImage()) return toast('先载入一张图片');
  const shiftRes = shiftForImage(state.width * state.height);
  if (!shiftRes.ok) return toast(`自定义 L 非法：${shiftRes.error}`);
  try {
    const result = applyRounds(state.data, {
      width: state.width, height: state.height, mode: state.mode, rounds: 1, inverse,
      shift: state.mode === 'custom' ? shiftRes.shift : undefined,
    }, state.spare);
    if (result !== state.data) [state.data, state.spare] = [result, state.data];
    state.ops += 1;
    state.steps += 1;
    render();
    updateStats();
  } catch (err) {
    toast(`处理失败：${err.message || err}`);
  }
}

function runTable(inverse) {
  if (!hasImage()) return toast('先载入一张图片');
  const table = currentTable();
  if (!table) return toast('编码表有问题，先修一下');
  const shiftRes = shiftForImage(state.width * state.height);
  if (!shiftRes.ok) return toast(`自定义 L 非法：${shiftRes.error}`);
  try {
    const result = applyTable(state.data, {
      width: state.width, height: state.height, mode: state.mode, table, inverse,
      shift: state.mode === 'custom' ? shiftRes.shift : undefined,
    }, state.spare);
    if (result !== state.data) [state.data, state.spare] = [result, state.data];
    state.ops += 1;
    state.steps += totalSteps(table);
    render();
    updateStats();
  } catch (err) {
    toast(`处理失败：${err.message || err}`);
  }
}

function restore() {
  if (!state.original) return;
  state.data = state.original.slice();
  state.spare = new Uint8ClampedArray(state.data.length);
  state.ops = 0;
  state.steps = 0;
  render();
  updateStats();
  toast('已还原到载入时的像素', true);
}

function download(type) {
  if (!hasImage()) return toast('先载入一张图片');
  const canvas = document.createElement('canvas');
  canvas.width = state.width;
  canvas.height = state.height;
  canvas.getContext('2d').putImageData(new ImageData(state.data, state.width, state.height), 0, 0);

  const quality = Math.min(100, Math.max(10, Number(els.jpgQuality.value) || 95)) / 100;
  const isPng = type === 'png';
  const mime = isPng ? 'image/png' : 'image/jpeg';
  const suffix = isPng ? '.png' : '.jpg';

  // 只在导出这一刻编码一次；PNG 无损，JPEG 用用户选的质量
  canvas.toBlob((blob) => {
    if (!blob) return toast('编码失败');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.name.replace(/\.[^.]+$/, '') + (state.ops ? `_x${state.steps}` : '_orig') + suffix;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`已导出 ${isPng ? 'PNG（无损）' : `JPEG q${Math.round(quality * 100)}`}`, true);
  }, mime, isPng ? undefined : quality);
}

/* ------------------------------------------------------------------ 示例图 */

function makeSample(width = 640, height = 480) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1), v = y / (height - 1);
      let r = 210 - 90 * u + 20 * Math.sin(v * 6);
      let g = 120 + 100 * v - 30 * u;
      let b = 90 + 120 * u * (1 - 0.4 * v);
      if (x % 6 === 0 || y % 6 === 0) { r *= 0.55; g *= 0.55; b *= 0.55; }
      const dx = x - width * 0.7, dy = y - height * 0.3;
      if (dx * dx + dy * dy < (Math.min(width, height) * 0.12) ** 2) { r = 240; g = 200; b = 60; }
      const dx2 = x - width * 0.3, dy2 = y - height * 0.65;
      if (dx2 * dx2 + dy2 * dy2 < (Math.min(width, height) * 0.09) ** 2) { r = 60; g = 90; b = 200; }
      if (x > width * 0.05 && x < width * 0.35 && y > height * 0.05 && y < height * 0.18) { r = 128; g = 128; b = 128; }
      if (x > width * 0.62 && x < width * 0.95 && y > height * 0.80 && y < height * 0.95) { r = 235; g = 235; b = 235; }
      const n = (Math.random() - 0.5) * 2.4;
      const i = (y * width + x) * 4;
      data[i] = Math.max(0, Math.min(255, r + n));
      data[i + 1] = Math.max(0, Math.min(255, g + n));
      data[i + 2] = Math.max(0, Math.min(255, b + n));
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/* ------------------------------------------------------------------ 绑定 */

function bind() {
  $('pick').addEventListener('click', () => els.file.click());
  els.dropzone.addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', () => {
    const f = els.file.files?.[0];
    if (f) loadFile(f);
    els.file.value = '';
  });

  $('sample').addEventListener('click', () => {
    const s = makeSample();
    setImage({ ...s, name: 'sample.png' });
  });
  $('enc').addEventListener('click', () => runRounds(false));
  $('dec').addEventListener('click', () => runRounds(true));
  $('restore').addEventListener('click', restore);
  $('apply-enc').addEventListener('click', () => runTable(false));
  $('apply-dec').addEventListener('click', () => runTable(true));
  $('download-png').addEventListener('click', () => download('png'));
  $('download-jpg').addEventListener('click', () => download('jpg'));

  $('gen').addEventListener('click', () => {
    try {
      const table = generateTable({
        length: Number(els.genLength.value) || 8,
        range: Number(els.genRange.value) || 8,
      });
      els.table.value = formatTable(table);
      updateTableStats();
      toast(`已生成 ${table.length} 项编码表`, true);
    } catch (err) {
      toast(err.message);
    }
  });

  els.table.addEventListener('input', updateTableStats);
  els.mode.addEventListener('change', () => {
    state.mode = els.mode.value;
    updateCustomShiftUI();
    updateStats();
    updateTableStats();
  });
  els.customShift.addEventListener('input', () => {
    updateCustomShiftUI();
    updateStats();
    updateTableStats();
  });
  els.maxMp.addEventListener('change', () => {
    els.limitHint.textContent = `上限：${Number(els.maxMp.value).toFixed(1)} MP / 单边 ${DEFAULT_MAX_SIDE}px（超限直接报错）`;
  });

  // 拖放
  for (const evt of ['dragenter', 'dragover']) {
    els.dropzone.addEventListener(evt, (e) => { e.preventDefault(); els.dropzone.classList.add('drag'); });
  }
  for (const evt of ['dragleave', 'drop']) {
    els.dropzone.addEventListener(evt, (e) => { e.preventDefault(); els.dropzone.classList.remove('drag'); });
  }
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) loadFile(f);
  });

  // 粘贴
  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    const f = item.getAsFile();
    if (f) loadFile(f);
  });
}

function init() {
  state.mode = els.mode.value;
  els.limitHint.textContent = `上限：${(DEFAULT_MAX_PIXELS / 1e6).toFixed(0)} MP / 单边 ${DEFAULT_MAX_SIDE}px（超限直接报错）`;
  bind();
  updateCustomShiftUI();
  updateTableStats();
  setBusy(false);
}

init();
