# -*- coding: utf-8 -*-
"""核心算法（纯 Python，零三方依赖；有 numpy 时自动走快路径）

与 JS 版（src/core/*.js）逐位一致：
  - Gilbert 曲线：同样的递归切分、同样的 Math.floor 半宽、同样的入栈顺序；
  - 位移 L：compat = floor(φ⁻¹·N + 0.5)（即 JS 的 Math.round），int = (N×618)//1000；
  - 一次编码 = 沿曲线旋转 L；顺序表 = 一次净旋转 (Σ表项)·L。
"""

from __future__ import annotations

import math
from array import array

try:  # numpy 可选：只是加速，不影响结果
    import numpy as _np
except Exception:  # pragma: no cover
    _np = None

PHI_INV = (math.sqrt(5.0) - 1.0) / 2.0  # 0.6180339887498949
assert repr(PHI_INV) == "0.6180339887498949"

MODES = ("compat", "int")
MODE_LABEL = {"compat": "兼容模式（浮点取整）", "int": "整数模式（纯整数）"}

DEFAULT_MAX_PIXELS = 16_000_000
DEFAULT_MAX_SIDE = 8192

DEFAULT_TABLE_LENGTH = 8
DEFAULT_TABLE_RANGE = 8
MAX_TABLE_LENGTH = 512
MAX_ABS_ENTRY = 64


class ImageTooLargeError(ValueError):
    def __init__(self, width: int, height: int, max_pixels: int, max_side: int):
        mp = width * height / 1e6
        parts = []
        if width * height > max_pixels:
            parts.append(f"{mp:.2f} MP 超过上限 {max_pixels / 1e6:.2f} MP")
        if max(width, height) > max_side:
            parts.append(f"单边 {max(width, height)} 超过上限 {max_side}")
        super().__init__(
            f"图片过大：{width}×{height} —— {'；'.join(parts)}。请先裁切 / 降分辨率后再试。"
        )
        self.width = width
        self.height = height


def assert_size(width: int, height: int, *, max_pixels: int = DEFAULT_MAX_PIXELS,
                max_side: int = DEFAULT_MAX_SIDE) -> None:
    if not isinstance(width, int) or not isinstance(height, int) or width < 1 or height < 1:
        raise ValueError(f"图片尺寸非法: {width}×{height}")
    if width * height > max_pixels or width > max_side or height > max_side:
        raise ImageTooLargeError(width, height, max_pixels, max_side)


# ---------------------------------------------------------------- 位移
def shift_for(mode: str, n: int) -> int:
    if mode == "compat":
        return int(math.floor(PHI_INV * n + 0.5))
    if mode == "int":
        return (n * 618) // 1000
    raise ValueError(f"未知模式: {mode}")


# ---------------------------------------------------------------- Gilbert
def gilbert_order(width: int, height: int) -> array:
    """返回 array('i')，第 k 个点是行主序像素下标 (x + y*width)。"""
    if width < 1 or height < 1:
        raise ValueError(f"尺寸非法: {width}×{height}")

    n = width * height
    out = array("i", bytes(4 * n))
    pos = 0
    stack = [(0, 0, width, 0, 0, height)] if width >= height else [(0, 0, 0, height, width, 0)]

    while stack:
        x, y, ax, ay, bx, by = stack.pop()
        m = abs(ax + ay)
        l = abs(bx + by)
        dax = (ax > 0) - (ax < 0)
        day = (ay > 0) - (ay < 0)
        dbx = (bx > 0) - (bx < 0)
        dby = (by > 0) - (by < 0)

        if l == 1:
            base = x + y * width
            step = dax + day * width
            out[pos:pos + m] = array("i", range(base, base + m * step, step))
            pos += m
            continue
        if m == 1:
            base = x + y * width
            step = dbx + dby * width
            out[pos:pos + l] = array("i", range(base, base + l * step, step))
            pos += l
            continue

        ax2, ay2 = ax // 2, ay // 2   # Python 的 // 对负数向下取整，与 Math.floor 一致
        bx2, by2 = bx // 2, by // 2
        w2 = abs(ax2 + ay2)
        h2 = abs(bx2 + by2)

        if 2 * m > 3 * l:
            if (w2 % 2) and m > 2:
                ax2 += dax
                ay2 += day
            stack.append((x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by))
            stack.append((x, y, ax2, ay2, bx, by))
        else:
            if (h2 % 2) and l > 2:
                bx2 += dbx
                by2 += dby
            stack.append((x + (ax - dax) + (bx2 - dbx), y + (ay - day) + (by2 - dby),
                          -bx2, -by2, -(ax - ax2), -(ay - ay2)))
            stack.append((x + bx2, y + by2, ax, ay, bx - bx2, by - by2))
            stack.append((x, y, bx2, by2, ax2, ay2))

    if pos != n:
        raise RuntimeError(f"Gilbert 曲线长度异常: {pos} != {n}")
    return out


_ORDER_CACHE: dict[tuple[int, int], array] = {}


def order_for(width: int, height: int) -> array:
    key = (width, height)
    hit = _ORDER_CACHE.get(key)
    if hit is None:
        if len(_ORDER_CACHE) >= 3:
            _ORDER_CACHE.clear()
        hit = gilbert_order(width, height)
        _ORDER_CACHE[key] = hit
    return hit


# ---------------------------------------------------------------- 置换
def permute_into(src: array, dst: array, order: array, shift: int, inverse: bool = False) -> array:
    """src/dst 都是 array('I')（每个元素 = 一个 RGBA 像素的 32 位字）。"""
    n = len(order)
    s = shift % n
    if inverse:
        s = (n - s) % n
    if s == 0:
        dst[:] = src
        return dst

    split = n - s
    if _np is not None:
        idx = _np.frombuffer(order, dtype=_np.int32)
        d = _np.frombuffer(dst, dtype=_np.uint32)
        sc = _np.frombuffer(src, dtype=_np.uint32)
        d[idx[s:]] = sc[idx[:split]]
        d[idx[:s]] = sc[idx[split:]]
        return dst

    o = order
    d = dst
    sc = src
    for k in range(split):
        d[o[k + s]] = sc[o[k]]
    for k in range(split, n):
        d[o[k - split]] = sc[o[k]]
    return dst


def apply_rounds(pixels: array, width: int, height: int, mode: str, rounds: int,
                 inverse: bool = False) -> array:
    n = width * height
    order = order_for(width, height)
    shift = shift_for(mode, n)
    src = pixels
    dst = array("I", bytes(4 * n))
    for _ in range(rounds):
        permute_into(src, dst, order, shift, inverse)
        src, dst = dst, src
    return src


def table_shift(n: int, mode: str, table: list[int], inverse: bool = False) -> int:
    steps = net_steps(invert_table(table) if inverse else table)
    return (shift_for(mode, n) * (steps % n)) % n


def apply_table(pixels: array, width: int, height: int, mode: str, table: list[int],
                inverse: bool = False) -> array:
    n = width * height
    order = order_for(width, height)
    dst = array("I", bytes(4 * n))
    return permute_into(pixels, dst, order, table_shift(n, mode, table, inverse), False)


# ---------------------------------------------------------------- 顺序表
def parse_table(text: str) -> list[int]:
    import re

    raw = " ".join(text.strip().split())
    if not raw:
        raise ValueError("编码表为空")
    if re.search(r"\d\.\d", raw):
        raise ValueError("只接受整数，表里出现了小数")
    items = [int(t) for t in re.findall(r"[+-]?\d+", raw)]
    if not items:
        raise ValueError("没有找到任何整数")
    if len(items) > MAX_TABLE_LENGTH:
        raise ValueError(f"表太长（{len(items)} > {MAX_TABLE_LENGTH}）")
    for v in items:
        if abs(v) > MAX_ABS_ENTRY:
            raise ValueError(f"表项 {v} 超出范围 ±{MAX_ABS_ENTRY}")
    return items


def format_table(table: list[int]) -> str:
    return "[" + ", ".join(str(v) for v in table) + "]"


def invert_table(table: list[int]) -> list[int]:
    return [-table[len(table) - 1 - i] for i in range(len(table))]


def net_steps(table: list[int]) -> int:
    return sum(table)


def total_steps(table: list[int]) -> int:
    return sum(abs(v) for v in table)


def describe_table(table: list[int]) -> str:
    return " → ".join("不动" if v == 0 else (f"正向 {v}" if v > 0 else f"反向 {-v}") for v in table)


def generate_table(length: int = DEFAULT_TABLE_LENGTH, rng_range: int = DEFAULT_TABLE_RANGE) -> list[int]:
    import secrets

    if not (1 <= length <= MAX_TABLE_LENGTH):
        raise ValueError(f"表长度非法: {length}")
    if not (1 <= rng_range <= MAX_ABS_ENTRY):
        raise ValueError(f"幅度非法: {rng_range}")
    out = []
    while len(out) < length:
        v = secrets.randbelow(2 * rng_range + 1) - rng_range
        if v != 0:
            out.append(v)
    return out


def apply_table_sequential(pixels: array, width: int, height: int, mode: str,
                           table: list[int], inverse: bool = False) -> array:
    """朴素实现：逐项逐次执行（只用于对拍/基准，大图勿用）。"""
    n = width * height
    order = order_for(width, height)
    shift = shift_for(mode, n)
    steps = invert_table(table) if inverse else table
    src = pixels
    dst = array("I", bytes(4 * n))
    count = 0
    for k in steps:
        for _ in range(abs(k)):
            permute_into(src, dst, order, shift, k < 0)
            src, dst = dst, src
            count += 1
    if count == 0:
        return array("I", pixels)
    return src
