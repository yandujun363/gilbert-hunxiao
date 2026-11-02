#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CLI / 无头版本的 Python 实现（零三方依赖；有 numpy / Pillow 会自动加速）

与 ci/cli.mjs 的用法、输出、算法完全对应，产物逐字节相同（test/py-parity.test.mjs 会对拍）。

用法：
  python3 ci/py/gilbert_cli.py encode in.png out.png --mode compat --rounds 3
  python3 ci/py/gilbert_cli.py encode in.png out.png --table "[1,-3,4,7,-5,7]"
  python3 ci/py/gilbert_cli.py decode in.png out.png --table "[1,-3,4,7,-5,7]"
  python3 ci/py/gilbert_cli.py gen-table --length 8 --range 8
  python3 ci/py/gilbert_cli.py info in.png --table "[1,-3,4,7,-5,7]"
  python3 ci/py/gilbert_cli.py selftest
  python3 ci/py/gilbert_cli.py bench --mp 1
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from array import array
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import gilbert_core as core  # noqa: E402
import gilbert_png as png  # noqa: E402


def sha_i32(arr: array) -> str:
    if sys.byteorder == "big":
        tmp = array("i", arr)
        tmp.byteswap()
        return hashlib.sha256(tmp.tobytes()).hexdigest()
    return hashlib.sha256(arr.tobytes()).hexdigest()


def to_pixels(rgba: bytes | bytearray) -> array:
    a = array("I")
    a.frombytes(bytes(rgba))
    return a


def custom_shift_from(args: argparse.Namespace) -> int | None:
    """解析并校验 --mode / --shift 组合；只有 custom 模式会返回 L。"""
    custom = None
    if args.shift is not None:
        try:
            custom = core.parse_shift(args.shift)
        except ValueError as err:
            fail(f"--shift 解析失败：{err}", 2)
    if args.mode == "custom" and custom is None:
        fail("--mode custom 需要同时给 --shift L", 2)
    if args.mode != "custom" and custom is not None:
        fail("--shift 只能配合 --mode custom 使用", 2)
    return custom


def cmd_encode_decode(args: argparse.Namespace) -> int:
    inverse = args.command == "decode"
    if args.table is not None and args.rounds is not None:
        fail("--table 与 --rounds 只能二选一", 2)
    table = core.parse_table(args.table) if args.table is not None else None
    rounds = 1 if args.rounds is None else args.rounds
    if table is None and rounds < 0:
        fail("--rounds 必须是非负整数", 2)
    custom = custom_shift_from(args)

    max_pixels = int(round(args.max_mp * 1e6))
    data = Path(args.input).read_bytes()

    # 先只读 IHDR：超大图在解压前就挡掉
    info = png.read_png_info(data)
    try:
        core.assert_size(info["width"], info["height"], max_pixels=max_pixels)
    except core.ImageTooLargeError as err:
        fail(str(err))

    # 自定义 L 的范围校验也在解压之前：坏参数连解码阶段都不进
    if custom is not None:
        try:
            core.assert_custom_shift(custom, info["width"] * info["height"])
        except ValueError as err:
            fail(str(err), 2)

    t0 = time.perf_counter()
    width, height, rgba = png.decode_png(data)
    t1 = time.perf_counter()

    pixels = to_pixels(rgba)
    n = width * height
    if table is not None:
        out = core.apply_table(pixels, width, height, args.mode, table, inverse,
                               custom_shift=custom)
        steps = core.total_steps(table)
        net = core.table_shift(n, args.mode, table, inverse, custom)
    else:
        out = core.apply_rounds(pixels, width, height, args.mode, rounds, inverse,
                                custom_shift=custom)
        steps = rounds
        net = (core.shift_for(args.mode, n, custom) * (rounds % n)) % n
    t2 = time.perf_counter()

    Path(args.output).write_bytes(png.encode_png(width, height, out.tobytes()))
    t3 = time.perf_counter()

    report = {
        "command": args.command,
        "mode": args.mode,
        "width": width,
        "height": height,
        "megapixels": round(n / 1e6, 3),
        "table": core.format_table(table) if table else None,
        "rounds": None if table else rounds,
        "steps": steps,
        "customShift": custom,
        "singleShift": core.shift_for(args.mode, n, custom),
        "netShift": net,
        "ms": {
            "decode": round((t1 - t0) * 1000, 1),
            "permute": round((t2 - t1) * 1000, 1),
            "encode": round((t3 - t2) * 1000, 1),
        },
        "engine": {"numpy": core._np is not None, "pillow": png.HAVE_PILLOW},
    }
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    verb = "编码" if not inverse else "解码"
    head = f"✔ {verb}完成  {width}×{height} ({report['megapixels']} MP)  mode={args.mode}"
    if table is not None:
        detail = (f"  位移 L={report['singleShift']}  表 {report['table']}"
                  f"（展开 {steps} 步 → 折叠为 1 次旋转，净位移 {net}）")
    else:
        detail = f"  位移 L={report['singleShift']}  轮数={rounds}"
    print(head)
    print(detail)
    print(f"  耗时 解码 {report['ms']['decode']}ms · 置换 {report['ms']['permute']}ms"
          f" · 编码 {report['ms']['encode']}ms")
    print(f"  → {args.output}")
    return 0


def cmd_gen_table(args: argparse.Namespace) -> int:
    try:
        table = core.generate_table(args.length, args.range)
    except ValueError as err:
        fail(str(err), 2)
    if args.json:
        print(json.dumps({"table": table, "netSteps": core.net_steps(table),
                          "steps": core.total_steps(table)}, ensure_ascii=False))
        return 0
    print(core.format_table(table))
    print(f"  {core.describe_table(table)}")
    print(f"  净位移 {core.net_steps(table)} 次 · 展开 {core.total_steps(table)} 步")
    return 0


def cmd_info(args: argparse.Namespace) -> int:
    data = Path(args.input).read_bytes()
    info = png.read_png_info(data)
    n = info["width"] * info["height"]
    custom = custom_shift_from(args)
    if custom is not None:
        try:
            core.assert_custom_shift(custom, n)
        except ValueError as err:
            fail(str(err), 2)
    shifts = {"compat": core.shift_for("compat", n), "int": core.shift_for("int", n)}
    if custom is not None:
        shifts["custom"] = custom
    out = {
        "file": args.input,
        "width": info["width"],
        "height": info["height"],
        "megapixels": round(n / 1e6, 3),
        "bitDepth": info["bit_depth"],
        "colorType": info["color_type"],
        "shifts": shifts,
    }
    if args.table is not None:
        table = core.parse_table(args.table)
        out.update({
            "table": core.format_table(table),
            "steps": core.total_steps(table),
            "netSteps": core.net_steps(table),
            "netShift": core.table_shift(n, args.mode, table, False, custom),
            "netShiftInverse": core.table_shift(n, args.mode, table, True, custom),
        })
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


def cmd_selftest(_args: argparse.Namespace) -> int:
    failed = 0

    def check(name: str, cond: bool) -> None:
        nonlocal failed
        print(f"  {'PASS' if cond else 'FAIL'}  {name}")
        if not cond:
            failed += 1

    for w, h in [(8, 8), (13, 17), (64, 48), (1, 9), (37, 53)]:
        order = core.gilbert_order(w, h)
        n = w * h
        bijective = sorted(order) == list(range(n))
        continuous = all(
            abs(order[i - 1] % w - order[i] % w) + abs(order[i - 1] // w - order[i] // w) == 1
            for i in range(1, n)
        )
        check(f"{w}×{h} Gilbert 双射+连续", bijective and continuous)

    # 兼容模式（compat）的曲线哈希锚点：跨语言回归用
    anchors = {
        (8, 8): "2100f2b7e3621ba5578b5f54e2895ef379699958415dac0abb4e938ce8479d61",
        (63, 47): "daa142b7150c7ca5cea52de692c99a22a9714e5ac1cd560aa6608be09919b210",
        (320, 240): "55d97e67ded2b9a703c7e02a4262878892b58638e59e59b49ddac7cf9368c10a",
    }
    for (w, h), expect in anchors.items():
        check(f"{w}×{h} 曲线哈希与 JS 兼容实现一致", sha_i32(core.gilbert_order(w, h)) == expect)

    w, h = 37, 53
    n = w * h
    table = [1, -3, 4, 7, -5, 7]
    px = array("I", bytes(4 * n))
    for i in range(n):
        px[i] = (i * 2654435761) & 0xFFFFFFFF

    enc = core.apply_table(px, w, h, "compat", table)
    back = core.apply_table(enc, w, h, "compat", table, True)
    check("顺序表编码→解码 逐字节还原", enc is not px and list(back) == list(px))
    seq = core.apply_table_sequential(px, w, h, "compat", table)
    check("折叠 1 次 == 逐项展开 27 步", list(enc) == list(seq))

    custom_l = n - 11  # 故意偏离 φ⁻¹·N，验证自定义 L 真的生效
    enc_c = core.apply_rounds(px, w, h, "custom", 1, custom_shift=custom_l)
    back_c = core.apply_rounds(enc_c, w, h, "custom", 1, True, custom_shift=custom_l)
    check(f"自定义 L={custom_l} 编码→解码 逐字节还原", list(back_c) == list(px))
    try:
        core.apply_rounds(px, w, h, "custom", 1, custom_shift=n)
        rejected = False
    except ValueError:
        rejected = True
    check("自定义 L=N 越界被拒绝（不自动取模）", rejected)

    small = bytearray((i * 31 + 7) & 0xFF for i in range(23 * 19 * 4))
    buf = png.encode_png(23, 19, small)
    w2, h2, back2 = png.decode_png(buf)
    check("PNG 编码→解码 逐字节还原", (w2, h2) == (23, 19) and bytes(back2) == bytes(small))

    print("\n" + ("全部通过" if not failed else f"{failed} 项失败"))
    return 0 if not failed else 1


def cmd_bench(args: argparse.Namespace) -> int:
    side = int(round((args.mp * 1e6) ** 0.5))
    width = height = side
    n = width * height
    table = [1, -3, 4, 7, -5, 7]
    px = array("I", bytes(4 * n))

    core._ORDER_CACHE.clear()
    t = time.perf_counter()
    order = core.order_for(width, height)   # 冷启动；顺便放进缓存供后面复用
    t_order = time.perf_counter() - t

    t = time.perf_counter()
    core.permute_into(px, array("I", bytes(4 * n)), order, core.shift_for("compat", n))
    t_perm = time.perf_counter() - t

    t = time.perf_counter()
    core.apply_table(px, width, height, "compat", table)
    t_fold = time.perf_counter() - t

    seq = "跳过（太慢）"
    speedup = f"≈{core.total_steps(table)}×"
    if n <= 1_000_000:
        t = time.perf_counter()
        core.apply_table_sequential(px, width, height, "compat", table)
        t_seq = time.perf_counter() - t
        seq = f"{t_seq * 1000:.0f} ms"
        speedup = f"{t_seq / max(t_fold, 1e-9):.1f}×"

    engine = []
    engine.append("numpy" if core._np is not None else "纯 Python")
    engine.append("Pillow" if png.HAVE_PILLOW else "stdlib PNG")
    print(f"Python 版 · {width}×{height}（{n / 1e6:.2f} MP）· 引擎：{' + '.join(engine)}")
    print(f"  曲线生成      {t_order * 1000:8.1f} ms")
    print(f"  单次置换      {t_perm * 1000:8.1f} ms")
    print(f"  表-折叠 1 步  {t_fold * 1000:8.1f} ms")
    print(f"  表-展开 27 步 {seq:>12}   （加速 {speedup}）")
    return 0


def fail(msg: str, code: int = 1) -> None:
    print(f"错误: {msg}", file=sys.stderr)
    raise SystemExit(code)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="gilbert-py", description="Gilbert 图片混淆 · CLI / 无头版本（Python）")
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--mode", choices=list(core.MODES), default="compat")
        p.add_argument("--shift", default=None,
                       help="自定义模式的 L：整数，且 0 ≤ L < 像素总数")
        p.add_argument("--rounds", type=int, default=None)
        p.add_argument("--table", default=None)
        p.add_argument("--max-mp", type=float, default=core.DEFAULT_MAX_PIXELS / 1e6)
        p.add_argument("--json", action="store_true")

    for name in ("encode", "decode"):
        p = sub.add_parser(name)
        p.add_argument("input")
        p.add_argument("output")
        common(p)

    p = sub.add_parser("gen-table")
    p.add_argument("--length", type=int, default=core.DEFAULT_TABLE_LENGTH)
    p.add_argument("--range", type=int, default=core.DEFAULT_TABLE_RANGE)
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("info")
    p.add_argument("input")
    p.add_argument("--table", default=None)
    p.add_argument("--mode", choices=list(core.MODES), default="compat")
    p.add_argument("--shift", default=None,
                   help="自定义模式的 L：整数，且 0 ≤ L < 像素总数")

    sub.add_parser("selftest")

    p = sub.add_parser("bench")
    p.add_argument("--mp", type=float, default=1.0)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    handlers = {
        "encode": cmd_encode_decode,
        "decode": cmd_encode_decode,
        "gen-table": cmd_gen_table,
        "info": cmd_info,
        "selftest": cmd_selftest,
        "bench": cmd_bench,
    }
    try:
        return handlers[args.command](args)
    except (ValueError, OSError) as err:
        fail(str(err))


if __name__ == "__main__":
    raise SystemExit(main())
