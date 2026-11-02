/**
 * 最小 PNG 编解码（只给 CLI 版本用，浏览器侧走 createImageBitmap + canvas）
 *
 * 只依赖 node:zlib，不装任何三方包：
 *  - 解码：8bit、非隔行、色彩类型 0/2/3/4/6 → RGBA
 *  - 编码：RGBA → 8bit RGBA PNG（filter 0）
 * 无损：像素字节原样进出，没有任何量化。
 */

import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function isPng(buf) {
  return buf.length >= 8 && buf.subarray(0, 8).equals(SIGNATURE);
}

function readU32(buf, off) {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

/** 只读 IHDR —— 用来在 inflate 之前就把超大图挡掉 */
export function readPngInfo(buf) {
  if (!isPng(buf)) throw new Error('不是 PNG 文件');
  if (buf.length < 33) throw new Error('PNG 文件被截断');
  const width = readU32(buf, 16);
  const height = readU32(buf, 20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const compression = buf[26];
  const filter = buf[27];
  const interlace = buf[28];
  return { width, height, bitDepth, colorType, compression, filter, interlace };
}

/**
 * @param {Buffer|Uint8Array} input
 * @returns {{width:number, height:number, data:Uint8ClampedArray}}
 */
export function decodePng(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const info = readPngInfo(buf);
  if (info.bitDepth !== 8 && info.bitDepth !== 1 && info.bitDepth !== 2 && info.bitDepth !== 4) {
    throw new Error(`不支持 ${info.bitDepth}bit PNG（支持 1/2/4/8bit），请先无损转换一次`);
  }
  if (info.interlace !== 0) throw new Error('不支持隔行（Adam7）PNG，请先重存为普通 PNG');
  if (!(info.colorType in CHANNELS)) throw new Error(`不支持的色彩类型: ${info.colorType}`);
  if (info.compression !== 0 || info.filter !== 0) throw new Error('不支持的 PNG 压缩/滤波方法');

  const { width, height, colorType, bitDepth } = info;
  const channels = CHANNELS[colorType];
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3);      // 反滤波用的 1 像素跨度
  const stride = Math.ceil((width * bitsPerPixel) / 8); // 每行字节数

  const idat = [];
  let palette = null;
  let trns = null;
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = readU32(buf, off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd > buf.length) throw new Error('PNG 数据被截断');
    if (type === 'IDAT') idat.push(buf.subarray(dataStart, dataEnd));
    else if (type === 'PLTE') palette = buf.subarray(dataStart, dataEnd);
    else if (type === 'tRNS') trns = buf.subarray(dataStart, dataEnd);
    else if (type === 'IEND') break;
    off = dataEnd + 4; // 跳过 CRC
  }
  if (idat.length === 0) throw new Error('PNG 缺少 IDAT');
  if (colorType === 3 && !palette) throw new Error('调色板 PNG 缺少 PLTE');

  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) {
    throw new Error(`PNG 像素数据不足（${raw.length} < ${(stride + 1) * height}）`);
  }

  // 反滤波
  const flat = Buffer.allocUnsafe(stride * height);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[rp++];
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rp + x];
      const a = x >= bpp ? flat[row + x - bpp] : 0;
      const b = y > 0 ? flat[prev + x] : 0;
      const c = x >= bpp && y > 0 ? flat[prev + x - bpp] : 0;
      let out;
      if (ft === 0) out = v;
      else if (ft === 1) out = v + a;
      else if (ft === 2) out = v + b;
      else if (ft === 3) out = v + ((a + b) >> 1);
      else if (ft === 4) out = v + paeth(a, b, c);
      else throw new Error(`未知的行滤波类型: ${ft}`);
      flat[row + x] = out & 0xff;
    }
    rp += stride;
  }

  // 转 RGBA
  const n = width * height;
  const rgba = new Uint8ClampedArray(n * 4);

  if (bitDepth < 8) {
    // 1/2/4bit：每字节打包多个样本（灰度或调色板索引）
    const perByte = 8 / bitDepth;
    const mask = (1 << bitDepth) - 1;
    const maxVal = mask;
    for (let y = 0; y < height; y++) {
      const row = y * stride;
      for (let x = 0; x < width; x++) {
        const byte = flat[row + ((x / perByte) | 0)];
        const shift = (perByte - 1 - (x % perByte)) * bitDepth;
        const sample = (byte >> shift) & mask;
        const i = (y * width + x) * 4;
        if (colorType === 3) {
          if (!palette || sample >= palette.length / 3) throw new Error('调色板索引越界');
          rgba[i] = palette[sample * 3];
          rgba[i + 1] = palette[sample * 3 + 1];
          rgba[i + 2] = palette[sample * 3 + 2];
          rgba[i + 3] = trns && sample < trns.length ? trns[sample] : 255;
        } else {
          const g = maxVal === 255 ? sample : Math.round((sample * 255) / maxVal);
          rgba[i] = g; rgba[i + 1] = g; rgba[i + 2] = g; rgba[i + 3] = 255;
        }
      }
    }
    return { width, height, data: rgba };
  }

  if (colorType === 6) {
    rgba.set(flat.subarray(0, n * 4));
  } else if (colorType === 2) {
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      rgba[i * 4] = flat[j];
      rgba[i * 4 + 1] = flat[j + 1];
      rgba[i * 4 + 2] = flat[j + 2];
      rgba[i * 4 + 3] = 255;
    }
  } else if (colorType === 0) {
    for (let i = 0; i < n; i++) {
      const g = flat[i];
      rgba[i * 4] = g; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = g; rgba[i * 4 + 3] = 255;
    }
  } else if (colorType === 4) {
    for (let i = 0, j = 0; i < n; i++, j += 2) {
      rgba[i * 4] = flat[j]; rgba[i * 4 + 1] = flat[j]; rgba[i * 4 + 2] = flat[j];
      rgba[i * 4 + 3] = flat[j + 1];
    }
  } else { // colorType === 3
    const entries = palette.length / 3;
    for (let i = 0; i < n; i++) {
      const idx = flat[i];
      if (idx >= entries) throw new Error('调色板索引越界');
      rgba[i * 4] = palette[idx * 3];
      rgba[i * 4 + 1] = palette[idx * 3 + 1];
      rgba[i * 4 + 2] = palette[idx * 3 + 2];
      rgba[i * 4 + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return { width, height, data: rgba };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.allocUnsafe(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.allocUnsafe(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4, 8), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * RGBA → PNG（无损）
 * @param {{width:number, height:number, data:Uint8ClampedArray|Uint8Array}} image
 * @param {{level?:number}} [options]
 * @returns {Buffer}
 */
export function encodePng(image, options = {}) {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`尺寸非法: ${width}×${height}`);
  }
  const stride = width * 4;
  if (data.length !== stride * height) throw new RangeError(`像素数据长度不对: ${data.length} != ${stride * height}`);

  const raw = Buffer.allocUnsafe((stride + 1) * height);
  const src = Buffer.from(data.buffer, data.byteOffset, data.length);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    src.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: options.level ?? 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
