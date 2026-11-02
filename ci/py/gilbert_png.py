# -*- coding: utf-8 -*-
"""最小 PNG 编解码（纯 stdlib：zlib + struct）

- 解码：8bit / 1·2·4bit，色彩类型 0/2/3/4/6 → RGBA
- 编码：RGBA → 8bit RGBA PNG（filter 0）
- 装了 Pillow 时自动用它做 I/O（快很多），结果同为 RGBA 字节
"""

from __future__ import annotations

import io
import struct
import zlib

SIG = b"\x89PNG\r\n\x1a\n"
CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}

try:  # 可选加速
    from PIL import Image as _Image
except Exception:  # pragma: no cover
    _Image = None

HAVE_PILLOW = _Image is not None


def is_png(data: bytes) -> bool:
    return data[:8] == SIG


def read_png_info(data: bytes) -> dict:
    if not is_png(data):
        raise ValueError("不是 PNG 文件")
    if len(data) < 33:
        raise ValueError("PNG 文件被截断")
    width, height = struct.unpack(">II", data[16:24])
    bit_depth, color_type, compression, filt, interlace = data[24:29]
    return {"width": width, "height": height, "bit_depth": bit_depth,
            "color_type": color_type, "compression": compression,
            "filter": filt, "interlace": interlace}


def decode_png(data: bytes) -> tuple[int, int, bytearray]:
    info = read_png_info(data)
    if _Image is not None:
        with _Image.open(io.BytesIO(data)) as im:
            im = im.convert("RGBA")
            return im.width, im.height, bytearray(im.tobytes())

    # ---- 纯 stdlib ----
    width, height = info["width"], info["height"]
    bit_depth, color_type = info["bit_depth"], info["color_type"]
    if bit_depth not in (1, 2, 4, 8):
        raise ValueError(f"不支持 {bit_depth}bit PNG，请先无损转换一次")
    if info["interlace"] != 0:
        raise ValueError("不支持隔行（Adam7）PNG")
    if color_type not in CHANNELS:
        raise ValueError(f"不支持的色彩类型: {color_type}")
    if info["compression"] != 0 or info["filter"] != 0:
        raise ValueError("不支持的 PNG 压缩/滤波方法")

    channels = CHANNELS[color_type]
    bpp = max(1, (channels * bit_depth) // 8)
    stride = (width * channels * bit_depth + 7) // 8

    idat = []
    palette = None
    trns = None
    off = 8
    while off + 8 <= len(data):
        length = struct.unpack(">I", data[off:off + 4])[0]
        ctype = data[off + 4:off + 8]
        body = data[off + 8:off + 8 + length]
        if ctype == b"IDAT":
            idat.append(body)
        elif ctype == b"PLTE":
            palette = body
        elif ctype == b"tRNS":
            trns = body
        elif ctype == b"IEND":
            break
        off += 12 + length
    if not idat:
        raise ValueError("PNG 缺少 IDAT")
    if color_type == 3 and not palette:
        raise ValueError("调色板 PNG 缺少 PLTE")

    raw = zlib.decompress(b"".join(idat))
    if len(raw) < (stride + 1) * height:
        raise ValueError("PNG 像素数据不足")

    flat = bytearray(stride * height)
    rp = 0
    prev = bytes(stride)
    for y in range(height):
        ft = raw[rp]
        rp += 1
        row = raw[rp:rp + stride]
        rp += stride
        start = y * stride
        if ft == 0:
            flat[start:start + stride] = row
            cur = row
        elif ft == 2:  # Up
            cur = bytes((a + b) & 0xFF for a, b in zip(row, prev))
            flat[start:start + stride] = cur
        else:
            out = bytearray(row)
            if ft == 1:  # Sub
                for x in range(bpp, stride):
                    out[x] = (out[x] + out[x - bpp]) & 0xFF
            elif ft == 3:  # Average
                for x in range(stride):
                    a = out[x - bpp] if x >= bpp else 0
                    out[x] = (out[x] + ((a + prev[x]) >> 1)) & 0xFF
            elif ft == 4:  # Paeth
                for x in range(stride):
                    a = out[x - bpp] if x >= bpp else 0
                    b = prev[x]
                    c = prev[x - bpp] if x >= bpp else 0
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                    out[x] = (out[x] + pr) & 0xFF
            else:
                raise ValueError(f"未知行滤波: {ft}")
            flat[start:start + stride] = out
            cur = bytes(out)
        prev = cur

    n = width * height
    rgba = bytearray(n * 4)

    if bit_depth < 8:
        per_byte = 8 // bit_depth
        mask = (1 << bit_depth) - 1
        for y in range(height):
            row = flat[y * stride:(y + 1) * stride]
            for x in range(width):
                byte = row[x // per_byte]
                shift = (per_byte - 1 - (x % per_byte)) * bit_depth
                sample = (byte >> shift) & mask
                i = (y * width + x) * 4
                if color_type == 3:
                    if sample * 3 + 2 >= len(palette):
                        raise ValueError("调色板索引越界")
                    rgba[i:i + 4] = bytes((
                        palette[sample * 3], palette[sample * 3 + 1], palette[sample * 3 + 2],
                        trns[sample] if trns and sample < len(trns) else 255))
                else:
                    g = sample if mask == 255 else round(sample * 255 / mask)
                    rgba[i:i + 4] = bytes((g, g, g, 255))
        return width, height, rgba

    if color_type == 6:
        rgba[:] = flat
    elif color_type == 2:
        for i in range(n):
            j = i * 3
            rgba[i * 4:i * 4 + 4] = bytes((flat[j], flat[j + 1], flat[j + 2], 255))
    elif color_type == 0:
        for i in range(n):
            g = flat[i]
            rgba[i * 4:i * 4 + 4] = bytes((g, g, g, 255))
    elif color_type == 4:
        for i in range(n):
            j = i * 2
            rgba[i * 4:i * 4 + 4] = bytes((flat[j], flat[j], flat[j], flat[j + 1]))
    else:  # 3
        for i in range(n):
            idx = flat[i]
            if idx * 3 + 2 >= len(palette):
                raise ValueError("调色板索引越界")
            rgba[i * 4:i * 4 + 4] = bytes((
                palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2],
                trns[idx] if trns and idx < len(trns) else 255))
    return width, height, rgba


def _chunk(ctype: bytes, body: bytes) -> bytes:
    return (struct.pack(">I", len(body)) + ctype + body
            + struct.pack(">I", zlib.crc32(ctype + body) & 0xFFFFFFFF))


def encode_png(width: int, height: int, rgba: bytes | bytearray, level: int = 6) -> bytes:
    if width < 1 or height < 1:
        raise ValueError(f"尺寸非法: {width}×{height}")
    if len(rgba) != width * height * 4:
        raise ValueError(f"像素数据长度不对: {len(rgba)} != {width * height * 4}")

    stride = width * 4
    raw = bytearray((stride + 1) * height)
    view = memoryview(rgba)
    for y in range(height):
        raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)] = view[y * stride:(y + 1) * stride]

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"".join([
        SIG,
        _chunk(b"IHDR", ihdr),
        _chunk(b"IDAT", zlib.compress(bytes(raw), level)),
        _chunk(b"IEND", b""),
    ])
