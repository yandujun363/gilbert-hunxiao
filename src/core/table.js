/**
 * 顺序表（编码表）
 *
 * 表 [1, -3, 4, 7, -5, 7] 的含义：
 *   正向编码 1 次 → 反向编码 3 次 → 正向 4 次 → 正向 7 次 → 反向 5 次 → 正向 7 次
 *
 * 因为「一次编码」就是沿曲线旋转 L，所以正向 k 次 = 旋转 k·L、反向 k 次 = 旋转 −k·L，
 * 整张表等价于旋转 (Σ 表项)·L。解码 = 把表倒过来并逐项取反（[1,-3] → [3,-1]）。
 *
 * 互操作边界：折叠只在本项目内生效。外部只认单次 L 的实现即使规则相同，
 * 也只能手动按对方向重复 |Σ表项| 次才能还原，无法一键解表。
 *
 * 注意：旋转可交换，所以「倒序 + 取反」与「只取反」等价；这里仍按用户描述的
 * 倒序取表来实现，两个实现在测试里互相校验（见 test/table.test.mjs）。
 */

export const DEFAULT_TABLE_LENGTH = 8;
export const DEFAULT_TABLE_RANGE = 8;
export const MAX_TABLE_LENGTH = 512;
export const MAX_ABS_ENTRY = 64;

/**
 * 宽松解析：支持 JSON 数组、逗号/空格/分号/换行/中文顿号分隔。
 * @param {string} text
 * @returns {{ok: true, table: number[]} | {ok: false, error: string}}
 */
export function parseTable(text) {
  if (typeof text !== 'string') return { ok: false, error: '编码表必须是文本' };
  const raw = text.trim();
  if (!raw) return { ok: false, error: '编码表为空' };

  // 先尝试 JSON（允许 [1, -3] 这种带括号的写法）
  let items;
  const numbers = raw.match(/[+-]?\d+/g);
  if (!numbers) return { ok: false, error: '没有找到任何整数' };
  items = numbers.map((s) => Number(s));

  // JSON 里若出现小数/非整数，正则会把 1.5 读成 1 和 5，这里用粗筛兜一下
  if (/\d\.\d/.test(raw.replace(/\s/g, ''))) {
    return { ok: false, error: '只接受整数，表里出现了小数' };
  }
  if (items.length > MAX_TABLE_LENGTH) {
    return { ok: false, error: `表太长（${items.length} > ${MAX_TABLE_LENGTH}）` };
  }
  for (const v of items) {
    if (!Number.isInteger(v)) return { ok: false, error: `不是整数: ${v}` };
    if (Math.abs(v) > MAX_ABS_ENTRY) {
      return { ok: false, error: `表项 ${v} 超出范围 ±${MAX_ABS_ENTRY}` };
    }
  }
  return { ok: true, table: items };
}

/** @param {number[]} table */
export function formatTable(table) {
  return `[${table.join(', ')}]`;
}

/**
 * 解码用的表：倒着取，并逐项取反。
 * @param {number[]} table
 * @returns {number[]}
 */
export function invertTable(table) {
  const out = new Array(table.length);
  for (let i = 0; i < table.length; i++) out[i] = -table[table.length - 1 - i];
  return out;
}

/**
 * 净位移（以「次」为单位）：正数=正向，负数=反向。
 * @param {number[]} table
 */
export function netSteps(table) {
  let s = 0;
  for (const v of table) s += v;
  return s;
}

/** 表里一共要执行多少次单步置换（= Σ|k|），用来对比优化前后 */
export function totalSteps(table) {
  let s = 0;
  for (const v of table) s += Math.abs(v);
  return s;
}

/**
 * 生成随机表：默认长度 8、取值范围 [-8, 8]（不含 0，因为 0 是空操作）。
 * @param {{length?: number, range?: number, rng?: () => number}} [options]
 */
export function generateTable(options = {}) {
  const length = options.length ?? DEFAULT_TABLE_LENGTH;
  const range = options.range ?? DEFAULT_TABLE_RANGE;
  if (!Number.isInteger(length) || length < 1 || length > MAX_TABLE_LENGTH) {
    throw new RangeError(`表长度非法: ${length}`);
  }
  if (!Number.isInteger(range) || range < 1 || range > MAX_ABS_ENTRY) {
    throw new RangeError(`幅度非法: ${range}`);
  }
  const rng = options.rng ?? defaultRng;
  const out = new Array(length);
  for (let i = 0; i < length; i++) {
    let v = 0;
    while (v === 0) v = Math.floor(rng() * (2 * range + 1)) - range;
    out[i] = v;
  }
  return out;
}

function defaultRng() {
  const g = globalThis.crypto;
  if (g && typeof g.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    g.getRandomValues(buf);
    return buf[0] / 0x1_0000_0000;
  }
  return Math.random();
}

/** 人类可读描述：正向 1 → 反向 3 → …… */
export function describeTable(table) {
  return table
    .map((k) => (k > 0 ? `正向 ${k}` : k < 0 ? `反向 ${-k}` : '不动'))
    .join(' → ');
}
