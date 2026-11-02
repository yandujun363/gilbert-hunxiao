/**
 * 位移 / 取整规则
 *
 * 一次「编码」= 沿 Gilbert 曲线把像素整体后移 L 个位置（模 N）。
 * 三种模式：
 *
 *   compat（兼容模式）  L = round(φ⁻¹·N)，φ⁻¹=(√5−1)/2
 *                       单次编码与同取整规则的实现逐位一致、可一键互解；
 *                       多轮/顺序表之后净位移是 k·L，外部实现只能手动反向 |k| 次。
 *   int   （整数模式）  L = (N × 618) / 1000 向下取整，全程整数，不引入浮点库差异。
 *   custom（自定义模式） L 由调用方直接给出，必须是整数且 0 ≤ L < N；
 *                       越界直接报错，绝不自动取模 —— 避免“以为换了钥匙其实没换”。
 */

/** φ⁻¹ = 0.6180339887498949（与 JS/Python 的 IEEE754 double 结果一致） */
export const PHI_INV = (Math.sqrt(5) - 1) / 2;

export const MODES = /** @type {const} */ (['compat', 'int', 'custom']);

export const MODE_LABEL = {
  compat: '兼容模式（浮点取整）',
  int: '整数模式（纯整数）',
  custom: '自定义模式（手填 L）',
};

/**
 * @param {'compat'|'int'|'custom'} mode
 * @param {number} n 像素总数
 * @param {number} [customShift] 仅 custom 模式使用：0 ≤ L < n
 * @returns {number} 位移量
 */
export function shiftFor(mode, n, customShift) {
  assertCount(n);
  if (mode === 'compat') {
    // 正数域下 Math.round(x) == floor(x + 0.5)，与 Python 的 floor(x+0.5) 一致
    return Math.round(PHI_INV * n);
  }
  if (mode === 'int') {
    return Math.trunc((n * 618) / 1000);
  }
  if (mode === 'custom') {
    assertCustomShift(customShift, n);
    return /** @type {number} */ (customShift);
  }
  throw new RangeError(`未知模式: ${String(mode)}`);
}

/**
 * 校验自定义位移：必须是整数，且 0 ≤ L < n。
 * 故意不做取模 —— 越界就是错，避免“输入了 100000 结果悄悄变成 5”这种静默事故。
 * @param {unknown} value
 * @param {number} n 像素总数
 * @returns {number}
 */
export function assertCustomShift(value, n) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new RangeError(`自定义 L 必须是整数（收到 ${String(value)}）`);
  }
  if (value < 0 || value >= n) {
    throw new RangeError(`自定义 L 必须在 0 ≤ L < ${n} 之间（收到 ${value}）`);
  }
  return value;
}

/**
 * 严格解析用户输入的 L：只认十进制整数（不认小数、指数、空串）。
 * @param {unknown} text
 * @returns {{ok: true, shift: number} | {ok: false, error: string}}
 */
export function parseShift(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, error: 'L 不能为空' };
  if (!/^[+-]?\d+$/.test(raw)) return { ok: false, error: 'L 必须是十进制整数' };
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return { ok: false, error: 'L 超出安全整数范围' };
  return { ok: true, shift: value };
}

/** 把任意整数位移规整到 0..n-1 */
export function normalizeShift(value, n) {
  const m = value % n;
  return m < 0 ? m + n : m;
}

export function assertCount(n) {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`像素总数非法: ${n}`);
}
