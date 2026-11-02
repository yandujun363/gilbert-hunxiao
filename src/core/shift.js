/**
 * 位移 / 取整规则
 *
 * 一次「编码」= 沿 Gilbert 曲线把像素整体后移 L 个位置（模 N）。
 * L 只跟像素总数 N 有关，两种取整规则：
 *
 *   compat（兼容模式）  L = round(φ⁻¹·N)，φ⁻¹=(√5−1)/2
 *                       单次编码与同取整规则的实现逐位一致、可一键互解；
 *                       多轮/顺序表之后净位移是 k·L，外部实现只能手动反向 |k| 次。
 *   int   （整数模式）  L = (N × 618) / 1000 向下取整，全程整数，不引入浮点库差异。
 */

/** φ⁻¹ = 0.6180339887498949（与 JS/Python 的 IEEE754 double 结果一致） */
export const PHI_INV = (Math.sqrt(5) - 1) / 2;

export const MODES = /** @type {const} */ (['compat', 'int']);

export const MODE_LABEL = {
  compat: '兼容模式（浮点取整）',
  int: '整数模式（纯整数）',
};

/**
 * @param {'compat'|'int'} mode
 * @param {number} n 像素总数
 * @returns {number} 位移量（0..n-1 之外的原始值，使用时再取模）
 */
export function shiftFor(mode, n) {
  assertCount(n);
  if (mode === 'compat') {
    // 正数域下 Math.round(x) == floor(x + 0.5)，与 Python 的 floor(x+0.5) 一致
    return Math.round(PHI_INV * n);
  }
  if (mode === 'int') {
    return Math.trunc((n * 618) / 1000);
  }
  throw new RangeError(`未知模式: ${String(mode)}`);
}

/** 把任意整数位移规整到 0..n-1 */
export function normalizeShift(value, n) {
  const m = value % n;
  return m < 0 ? m + n : m;
}

export function assertCount(n) {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`像素总数非法: ${n}`);
}
