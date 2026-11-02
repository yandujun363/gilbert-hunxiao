/**
 * 尺寸限制 —— 超大图片直接报错（不偷偷缩放，缩放会改变像素网格且不可逆）
 */

export const DEFAULT_MAX_PIXELS = 16_000_000; // 16 MP
export const DEFAULT_MAX_SIDE = 8192;         // 单边上限（canvas 常见的 8192/16384 限制以内）

export class ImageTooLargeError extends Error {
  /**
   * @param {number} width
   * @param {number} height
   * @param {{maxPixels:number, maxSide:number}} limits
   */
  constructor(width, height, limits) {
    const mp = (width * height) / 1e6;
    const parts = [];
    if (width * height > limits.maxPixels) {
      parts.push(`${mp.toFixed(2)} MP 超过上限 ${(limits.maxPixels / 1e6).toFixed(2)} MP`);
    }
    if (width > limits.maxSide || height > limits.maxSide) {
      parts.push(`单边 ${Math.max(width, height)} 超过上限 ${limits.maxSide}`);
    }
    super(`图片过大：${width}×${height} —— ${parts.join('；')}。请先裁切 / 降分辨率后再试。`);
    this.name = 'ImageTooLargeError';
    this.width = width;
    this.height = height;
    this.limits = limits;
  }
}

/**
 * @param {number} width
 * @param {number} height
 * @param {{maxPixels?:number, maxSide?:number}} [options]
 * @throws {ImageTooLargeError}
 */
export function assertSize(width, height, options = {}) {
  const limits = {
    maxPixels: options.maxPixels ?? DEFAULT_MAX_PIXELS,
    maxSide: options.maxSide ?? DEFAULT_MAX_SIDE,
  };
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`图片尺寸非法: ${width}×${height}`);
  }
  if (width * height > limits.maxPixels || width > limits.maxSide || height > limits.maxSide) {
    throw new ImageTooLargeError(width, height, limits);
  }
  return limits;
}

/** 给用户看的体积描述：0.31 MP */
export function formatMegapixels(n) {
  return `${(n / 1e6).toFixed(2)} MP`;
}
