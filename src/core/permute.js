/**
 * 像素置换
 *
 * 一次编码：像素沿 Gilbert 路径整体后移 L 个位置（模 N）。
 *   dst[order[(k+L) % N]] = src[order[k]]
 * 解码即反向旋转。
 *
 * 关键优化（CI/大图必须）：
 *  1. 每像素是 4 字节且整体搬运，所以把两个缓冲区都看成 Uint32Array(N)，
 *     一次搬 1 个 32 位字而不是 4 个字节 —— 写入次数降为 1/4。
 *  2. 循环拆成两段（k < N-L 与 k >= N-L），避免每次取模。
 *  3. 乒乓缓冲：调用方给两个 buffer 轮换，单次置换不额外分配内存。
 *  4. 顺序表整体折叠成一次旋转（见 applyTable），不做逐项循环。
 */

import { gilbertOrder } from './gilbert.js';
import { shiftFor, normalizeShift } from './shift.js';
import { invertTable, netSteps } from './table.js';

const ORDER_CACHE = new Map();
const ORDER_CACHE_MAX = 3;

/** 取（并缓存）某个尺寸的曲线顺序 */
export function orderFor(width, height) {
  const key = `${width}x${height}`;
  const hit = ORDER_CACHE.get(key);
  if (hit) return hit;
  const order = gilbertOrder(width, height);
  if (ORDER_CACHE.size >= ORDER_CACHE_MAX) ORDER_CACHE.clear(); // 大图别囤太多
  ORDER_CACHE.set(key, order);
  return order;
}

/** 清缓存（测试/长时间运行用） */
export function clearOrderCache() {
  ORDER_CACHE.clear();
}

function asU32(buf, n) {
  if (!(buf instanceof Uint8Array) && !(buf instanceof Uint8ClampedArray)) {
    throw new TypeError('像素缓冲必须是 Uint8Array/Uint8ClampedArray');
  }
  if (buf.length !== n * 4) throw new RangeError(`缓冲区长度 ${buf.length} != ${n * 4}`);
  if (buf.byteOffset % 4 !== 0) throw new RangeError('缓冲区 byteOffset 必须 4 字节对齐');
  return new Uint32Array(buf.buffer, buf.byteOffset, n);
}

/**
 * 原地（写入 dst）做一次置换。
 * @param {Uint8ClampedArray|Uint8Array} src 源像素（RGBA）
 * @param {Uint8ClampedArray|Uint8Array} dst 目标像素（RGBA，可与 src 同一个? 不可以）
 * @param {Int32Array} order
 * @param {number} shift 位移量（可正可负，内部取模）
 * @param {boolean} [inverse] 是否反向
 * @returns {Uint8ClampedArray|Uint8Array} dst
 */
export function permuteInto(src, dst, order, shift, inverse = false) {
  const n = order.length;
  const s32 = asU32(src, n);
  const d32 = asU32(dst, n);
  let s = normalizeShift(shift, n);
  if (inverse) s = (n - s) % n;

  if (s === 0) {
    d32.set(s32);
    return dst;
  }

  const split = n - s;
  for (let k = 0; k < split; k++) d32[order[k + s]] = s32[order[k]];
  for (let k = split; k < n; k++) d32[order[k - split]] = s32[order[k]];
  return dst;
}

/**
 * 单步置换（返回新缓冲）。
 * @param {Uint8ClampedArray} pixels
 * @param {{width:number,height:number,mode:'compat'|'int',shift?:number,inverse?:boolean}} options
 */
export function permute(pixels, options) {
  const { width, height, mode, inverse = false } = options;
  const n = width * height;
  const order = orderFor(width, height);
  const shift = options.shift ?? shiftFor(mode, n);
  const out = new Uint8ClampedArray(pixels.length);
  permuteInto(pixels, out, order, shift, inverse);
  return out;
}

/**
 * 顺序表编码/解码的净位移（单位：像素位置）。
 * @param {number} n 像素总数
 * @param {'compat'|'int'} mode
 * @param {number[]} table
 * @param {boolean} [inverse] 解码时传 true
 */
export function tableShift(n, mode, table, inverse = false) {
  const t = inverse ? invertTable(table) : table;
  const L = shiftFor(mode, n);
  return normalizeShift(L * normalizeShift(netSteps(t), n), n);
}

/**
 * 按顺序表编码/解码 —— 一次扫描搞定。
 *
 * 表 [1,-3,4,7,-5,7] 展开是 27 次单步置换；但每次都是同一个旋转，
 * 所以合计等于旋转 (Σ 表项)·L，只做 1 次置换即可，结果逐像素相同。
 *
 * @param {Uint8ClampedArray|Uint8Array} pixels
 * @param {{width:number,height:number,mode:'compat'|'int',table:number[],inverse?:boolean}} options
 * @param {Uint8ClampedArray|Uint8Array} [out]
 */
export function applyTable(pixels, options, out) {
  const { width, height, mode, table, inverse = false } = options;
  if (!Array.isArray(table) || table.length === 0) throw new RangeError('编码表为空');
  const n = width * height;
  const order = orderFor(width, height);
  const dst = out ?? new Uint8ClampedArray(pixels.length);
  permuteInto(pixels, dst, order, tableShift(n, mode, table, inverse), false);
  return dst;
}

/**
 * 朴素实现：逐项、逐次执行（用于测试对拍与性能对比，勿用于大图）。
 * 只读 pixels，返回新缓冲。
 * @param {Uint8ClampedArray|Uint8Array} pixels
 * @param {{width:number,height:number,mode:'compat'|'int',table:number[],inverse?:boolean}} options
 */
export function applyTableSequential(pixels, options) {
  const { width, height, mode, table, inverse = false } = options;
  const n = width * height;
  const order = orderFor(width, height);
  const L = shiftFor(mode, n);
  const steps = inverse ? invertTable(table) : table;

  const a = new Uint8ClampedArray(pixels.length);
  a.set(pixels);
  const b = new Uint8ClampedArray(pixels.length);
  let src = a;
  let dst = b;
  let count = 0;

  for (const k of steps) {
    const times = Math.abs(k);
    for (let i = 0; i < times; i++) {
      permuteInto(src, dst, order, L, k < 0);
      const tmp = src; src = dst; dst = tmp;
      count++;
    }
  }
  return count === 0 ? a : src;
}

/**
 * 连续做 rounds 次单步置换（零拷贝乒乓）。
 * 注意：可能复用并写入传入的缓冲（rounds 为偶数时会写回 pixels），调用方不要再读旧缓冲。
 * @param {Uint8ClampedArray|Uint8Array} pixels
 * @param {{width:number,height:number,mode:'compat'|'int',rounds:number,inverse?:boolean}} options
 * @param {Uint8ClampedArray|Uint8Array} [out] 复用第二个缓冲（大图避免每次点击都新分配）
 */
export function applyRounds(pixels, options, out) {
  const { width, height, mode, inverse = false, rounds } = options;
  if (!Number.isInteger(rounds) || rounds < 0) throw new RangeError(`轮数非法: ${rounds}`);
  const n = width * height;
  const order = orderFor(width, height);
  const L = shiftFor(mode, n);
  let src = pixels;
  let dst = out ?? new Uint8ClampedArray(pixels.length);
  if (dst === pixels) throw new RangeError('out 不能与输入是同一个缓冲');
  for (let i = 0; i < rounds; i++) {
    permuteInto(src, dst, order, L, inverse);
    const t = src; src = dst; dst = t;
  }
  return src;
}
