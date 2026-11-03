# Gilbert 图片混淆（CLI 优先 · Node / Python + 无损网页版）

> [!WARNING]
> 此项目为纯Agent产物，由deepseek-harness+deepseek-flash全权编写
> 不保证项目可用性

把图片按 Gilbert 空间填充曲线打散成不可读的样子，再原样还原。
**像素只在内存里置换，整条链路不重新编码** —— 混淆多少次都不会掉画质。

- **CLI 优先**：`ci/cli.mjs`（Node）与 `ci/py/gilbert_cli.py`（Python），无头、零三方依赖、PNG 进 PNG 出，适合批处理、CI 和大图。
- **顺序表**：`[1, -3, 4, 7, -5, 7]` 这种"编码表"，编码按表走、解码倒着取表。
- **三种模式**：兼容模式（浮点取整，**仅单次编码**能与同规则实现一键互解）/ 整数模式（纯整数，不互通）/ **自定义模式**（手填 L，适合复现别的实现的位移）。
- **L 校验**：自定义 L 必须是整数且 `0 ≤ L < N`，越界直接报错，**绝不自动取模**。
- **大图保护**：超过上限直接报错，绝不偷偷缩放。
- **网页版（可选 GUI）**：内存直显，只有点下载时才编码一次。

> 项目主页（CLI 用法）：<https://gilbert.yangdujun.top/>
> 网页版：<https://gilbert.yangdujun.top/src/app/index.html>

---

## 目录

- [Gilbert 图片混淆（CLI 优先 · Node / Python + 无损网页版）](#gilbert-图片混淆cli-优先--node--python--无损网页版)
  - [目录](#目录)
  - [1. 30 秒上手（CLI）](#1-30-秒上手cli)
  - [2. CLI 命令参考](#2-cli-命令参考)
  - [3. 为什么不会「包浆」](#3-为什么不会包浆)
  - [4. 顺序表](#4-顺序表)
  - [5. 三种模式](#5-三种模式)
  - [6. 大图保护](#6-大图保护)
  - [7. 网页版（可选 GUI）](#7-网页版可选-gui)
  - [8. 目录结构](#8-目录结构)
  - [9. 测试](#9-测试)
  - [10. 性能](#10-性能)
  - [11. 常见问题](#11-常见问题)
  - [12. 已知边界](#12-已知边界)

---

## 1. 30 秒上手（CLI）

不需要 `npm install`，也没有任何三方依赖；Node ≥ 18 或 Python ≥ 3.10 即可。

```bash
# Node（推荐，大图快）
node ci/cli.mjs encode in.png out.png --rounds 3
node ci/cli.mjs decode out.png back.png --rounds 3

# 顺序表：编码按表正向走，解码自动倒表取反
node ci/cli.mjs encode in.png enc.png --table "[1,-3,4,7,-5,7]"
node ci/cli.mjs decode enc.png back.png --table "[1,-3,4,7,-5,7]"

# 自定义 L：0 ≤ L < 像素总数（123456 只是示例，越界会直接报错）
node ci/cli.mjs encode in.png enc.png --mode custom --shift 123456
node ci/cli.mjs decode enc.png back.png --mode custom --shift 123456

# Python（零依赖，可移植；装了 numpy / Pillow 会自动加速）
python3 ci/py/gilbert_cli.py encode in.png out.png --rounds 3
python3 ci/py/gilbert_cli.py decode out.png back.png --rounds 3
python3 ci/py/gilbert_cli.py selftest
```

`encode → decode` 之后应当**逐字节还原**。想先确认环境没问题：

```bash
node ci/cli.mjs selftest
node ci/cli.mjs gen-table --length 8 --range 8   # 生成一张随机顺序表
node ci/cli.mjs info in.png --table "[1,-3,4,7,-5,7]"
```

只想点鼠标？跑 `node tools/serve.mjs`，打开 `http://<本机IP>:8787/` 进网页版。
网页版是可选的 GUI，**日常批处理、大图、自动化建议直接用 CLI**。

## 2. CLI 命令参考

两个 CLI 的算法、参数名、输出字段一一对应，产物逐字节相同：

| 命令 | Node | Python | 作用 |
|---|---|---|---|
| `encode` | `node ci/cli.mjs encode in out` | `python3 ci/py/gilbert_cli.py encode in out` | 混淆 |
| `decode` | `node ci/cli.mjs decode in out` | `python3 ci/py/gilbert_cli.py decode in out` | 解混淆（`--table` 时自动倒表取反） |
| `gen-table` | `node ci/cli.mjs gen-table` | `python3 ci/py/gilbert_cli.py gen-table` | 生成随机顺序表 |
| `info` | `node ci/cli.mjs info in.png` | `python3 ci/py/gilbert_cli.py info in.png` | 尺寸 / 各模式的位移 / 表折叠后的净位移 |
| `selftest` | `node ci/cli.mjs selftest` | `python3 ci/py/gilbert_cli.py selftest` | 内置自检 |
| `bench` | `node ci/bench.mjs` | `python3 ci/py/gilbert_cli.py bench --mp 1` | 性能基准 |

通用参数：

| 参数 | 说明 |
|---|---|
| `--mode compat\|int\|custom` | L 规则，默认 `compat`（兼容模式） |
| `--shift L` | 仅 `--mode custom`：位移量，整数且 `0 ≤ L < 像素总数`；越界直接报错，不自动取模 |
| `--rounds N` | 连续置换 N 轮（与 `--table` 二选一） |
| `--table "T"` | 顺序表，如 `"[1,-3,4,7,-5,7]"` |
| `--max-mp N` | 像素上限（百万），默认 16 |
| `--json` | 机器可读输出（`encode` / `gen-table` / `info`） |

## 3. 为什么不会「包浆」

常见的做法是：每点一次按钮，就把画布重新编码成 JPEG/PNG 再喂回下一次。
JPEG 是有损的，而逆置换会把 8×8 块的量化误差打散成满图细颗粒，下一轮又压不掉 —— 误差逐轮叠加，这就是包浆。

本项目的两条路径都只在最后编码一次：

```
CLI：PNG 解码 → 内存里搬像素 → 置换 → PNG 输出（全程 1 次编码）
网页：载入时解码一次 → putImageData 直接显示 → 点「下载」时才编码一次
```

循环里**没有任何** `toBlob` / `toDataURL`。网页上「与原始图」一行实时对比刚载入的像素：

- 混淆 1 次 → 解混淆 1 次 → `逐像素相同（0 字节差异）`
- 按表编码（27 步）→ 按表解码 → 同样 `逐像素相同`
- 换整数模式再来一遍 → 仍然 `逐像素相同`

CLI 同理：PNG 进、PNG 出，中间只在内存里搬像素，没有任何有损编码器参与。

## 4. 顺序表

表 `[1, -3, 4, 7, -5, 7]` 表示：

```
正向编码 1 次 → 反向编码 3 次 → 正向编码 4 次 → 正向 7 次 → 反向 5 次 → 正向 7 次
```

- **编码**：按表从左到右执行，正数正向、负数反向。
- **解码**：把表倒过来并逐项取反 → `[-7, 5, -7, -4, 3, -1]`，再按新表执行。
- 解析宽松：`[1,-3,4,7,-5,7]`、`1 -3 4 7 -5 7`、`1、-3、4`、换行分隔都行；拒绝小数与 `|k| > 64`。
- 生成器：默认长度 8、范围 `[-8, +8]`（不含 0，因为 0 是空操作），用 `crypto` 随机。

**折叠优化（重要）**：一次编码 = 沿曲线旋转 L，所以正向 k 次 = 旋转 `k·L`、反向 = `−k·L`，
整张表等价于一次 `(Σ表项)·L` 的旋转。上表展开是 27 步，折叠后只做 **1 次** 重排，
结果逐像素相同（`test/table.test.mjs` 里有"折叠 vs 逐项"对拍），表越长优势越大。

**换实现要当心**：折叠是本项目内部的优化，别的工具只认单次 `L`。
所以按表编码的图，外部同规则实现要还原，只能手动按倒表逐项反向（上表逐项走是 27 次点击；
就算自己先算净位移，也得 11 次），方向、次数对人肉很不友好 —— 跨实现请回到单轮 compat（见 [§5](#5-三种模式)）。

## 5. 三种模式

一次编码的位移量 `L` 决定了「钥匙」。`compat` / `int` 由像素总数 `N` 算出，`custom` 由你直接填：

| 模式 | L | 说明 |
|---|---|---|
| `compat`（兼容模式） | `round(φ⁻¹·N)`，φ⁻¹=(√5−1)/2 | 单次编码与同规则实现逐位一致、可一键互解；多轮/带表则不能一键互解（见下） |
| `int`（整数模式） | `(N×618)/1000` 向下取整 | 全程整数，不依赖浮点库；与 `compat` **不互通** |
| `custom`（自定义模式） | 手填 `--shift L` | 必须是整数且 `0 ≤ L < N`；越界直接报错，**不自动取模** |

例：1280×720 时 compat 的 L=569580，int 的 L=569548。选错模式 = 用错钥匙，解出来就是乱码。
三种模式各自都完全可逆，像素运算永远是整数搬运。`custom` 只是换了 `L` 的来源，
`--rounds` / `--table` 照常可用（净位移 = k·L）。

**自定义 L 的校验（防止手滑把图送走）**

- 只认十进制整数：`--shift 7`、`--shift 0` 可以；`1.5`、`1e3`、空串一律报错。
- 范围必须 `0 ≤ L < N`（`N = 宽 × 高`）。越界**不会**悄悄取模，而是直接报错并给出合法范围，
  避免“输入 100000 结果静默变成 5”这种事故。
- CLI 的校验在 inflate 之前完成：坏参数连解码阶段都不进，不会先吃满内存再失败。
- `L = 0` 合法但空转（图像不变），适合做对照实验。

**什么时候用 custom？**

- 复现别的实现的 L：对方不按 `φ⁻¹` 取整、或版本/取整规则不同，就把它的 L 填进来；
- 做实验：固定一个 L 看混淆形态，或验证「同一 L 旋转 N 次」；
- 单轮 custom 且对方也能设同样的 L，才谈得上互解；否则只在项目内自洽。

> **兼容性说明（重要，别被「兼容」两个字骗了）**
>
> `compat` 的曲线与取整规则保持固定，但**跨实现互解只对「单次编码」成立** ——
> 也就是默认的 `--rounds 1` 且不带 `--table` 的产物：它恰好是沿曲线旋转 `L`，
> 别的同规则实现一次「解混淆」就能还原。
>
> 一旦用了 `--rounds N`（N>1）或 `--table`，净位移就变成 `k·L`（`k` = 轮数或表项之和）。
> 其它实现**仍然能解开，但不能一键**：只能手动把「混淆 / 解混淆」按对方向重复点 `|k|` 次，
> 方向和次数全靠人肉数，很容易点错、解废。
> 顺序表的折叠优化也救不了这一点 —— 折叠只在本项目内部生效，外部工具根本不认你的表。
>
> 所以约定：**跨实现互解 = 单轮 compat、不带表**；
> 多轮和顺序表只保证在本项目内互通（CLI / Python / 网页版都懂折叠）。
> `int` 是独立闭环，不参与任何互解；`custom` 只有双方约定同一个 L 时才互通。

## 6. 大图保护

- 默认上限 **16 MP** 或单边 **8192 px**（网页版可改「像素上限」，CLI 用 `--max-mp`）。
- 超过上限直接报错，给出具体数字，例如：
  `图片过大：640×480 —— 0.31 MP 超过上限 0.10 MP。请先裁切 / 降分辨率后再试。`
- CLI 在 **inflate 之前**只读 IHDR 就拦截，不会解压到一半把内存打爆。
- 不做自动缩放：缩放会改变像素网格且不可逆，别人的图就再也对不上。

## 7. 网页版（可选 GUI）

CLI 是主入口；网页版只是给不方便开终端时用的 GUI，功能对齐：

- 拖放 / 粘贴 / 选文件 → 混淆 / 解混淆 / 按表编码 / 按表解码 / 还原 / 导出；
- 默认上限 16 MP，超限直接报错；
- 显示走 `putImageData`，不二次编码；只有点「下载」时才编码一次。

```bash
node tools/serve.mjs   # http://<本机IP>:8787/ ，再从主页进「网页版」
```

**CLI 不能在浏览器里跑**：浏览器没有 Node / Python 运行时，也没有本地文件系统，
`ci/` 下的两个 CLI 只能跑在命令行或流水线里。两者共用同一套算法，产物逐字节互通 ——
网页版混淆的图可以 CLI 解开，反之亦然。

## 8. 目录结构

```
LICENSE               MIT 许可证
index.html            项目主页（CLI 优先；带「打开网页版」入口）
ci/cli.mjs            Node 版无头 CLI（主入口）
ci/py/gilbert_cli.py  Python 版无头 CLI（主入口）
ci/py/gilbert_core.py Python 版核心（纯 stdlib，numpy 可选）
ci/py/gilbert_png.py  Python 版 PNG 编解码（stdlib，Pillow 可选）
ci/bench.mjs          JS 性能基准
ci/make-fixture.mjs   CI 用测试图生成
src/core/gilbert.js   Gilbert 曲线（Int32Array 扁平栈，不建 [x,y] 小对象）
src/core/shift.js     位移 / 取整规则（compat / int）
src/core/table.js     顺序表：解析 / 格式化 / 取反 / 生成 / 净位移
src/core/permute.js   像素置换（Uint32 视图 + 乒乓缓冲 + 表折叠）
src/core/limits.js    尺寸上限与错误
src/core/png.js       最小 PNG 编解码（CLI 用，node:zlib，零三方依赖）
src/app/*             网页版（index.html / style.css / app.js）
test/*.test.mjs       node --test 单测（含跨语言对拍）
tools/serve.mjs       本地静态服务器
.github/workflows/ci.yml  单测 + 往返 + 拒绝超大图 + Python 自检 + 基准
```

## 9. 测试

```bash
node --test test/          # 核心算法 / 表 / PNG / 上限 / CLI / JS↔Python 对拍
node ci/cli.mjs selftest
python3 ci/py/gilbert_cli.py selftest
```

覆盖：曲线双射 + 路径连续 + **兼容模式的 sha256 回归锚点**；三种模式（含自定义 L 的校验与越界拒绝）；
顺序表解析 / 取反 / 折叠对拍；多轮往返逐字节还原；PNG 编解码（RGB / 灰度 / 调色板 / RGBA，含 1·2·4bit）；
尺寸上限；Node CLI 与 Python CLI 端到端；**JS 与 Python 产物逐字节相同**。

## 10. 性能

**Node（`node ci/bench.mjs --sizes 1,4,16`）**

| 像素 | 曲线 | 单次置换(Uint32) | 单次置换(Uint8) | 表-展开27步 | 表-折叠1步 |
|---|---|---|---|---|---|
| 1.0 MP | 27 ms | 2.6 ms | 4.4 ms | 72 ms | 2.6 ms |
| 4.0 MP | 166 ms | 10 ms | 19 ms | 281 ms | 13 ms |
| 16.0 MP | 468 ms | 63 ms | 124 ms | 跳过 | 494 ms |

**Python（`python3 ci/py/gilbert_cli.py bench --mp 1`，纯 stdlib）**

| 像素 | 曲线 | 单次置换 | 表-折叠1步 | 表-展开27步 |
|---|---|---|---|---|
| 1.0 MP | 553 ms | 81 ms | 78 ms | 2082 ms（26.7×）|
| 4.0 MP（+numpy） | 2191 ms | 36 ms | 23 ms | 跳过 |

优化点：
1. 像素缓冲按 `Uint32Array(N)` 搬 1 个 32 位字（而非 4 次字节写），JS 侧约 1.5~2×；
2. 顺序表折叠成 1 次旋转（27 步 → 1 步）；
3. 乒乓缓冲，逐轮置换不额外分配；曲线只存一份（4·N 字节）；
4. 先读 IHDR 再决定要不要 inflate，超大图不进入解码阶段；
5. Python 侧自动检测 numpy / Pillow，缺省走纯 stdlib（曲线生成是纯 Python 循环，大图请用 Node 版）。

## 11. 常见问题

**Q：下载的 JPEG 为什么还是糊？**
A：JPEG 本身有损，只在"导出"这一刻损失一次（不是每点一次掉一次）。要完全无损就导出 PNG，或直接用 CLI。

**Q：解出来是乱码？**
A：三种常见原因 —— ①模式选错（compat / int / custom）；②轮数、顺序表或自定义 L 不对；③图片被裁切 / 缩放 / 平台二次压缩过，像素网格变了。

**Q：别的网站 / 工具混淆的图，我能解开吗？对方能解我的吗？**
A：只有**单轮 compat、不带表**才真正互通（双方各点一次就行）。如果对方用了多轮或顺序表，
产物等价于旋转了 `k·L`，你这边仍能解，但得手动按对方向重复点 `k` 次，数错一次就白跑；
反过来你的表图也一样，要靠对方人肉还原。所以要做跨实现交换，双方都约定单轮 compat。
如果对方的 L 不是 `round(φ⁻¹·N)`（不同版本 / 不同取整），用 `--mode custom --shift <对方的 L>` 单轮复现。

**Q：手机上能用吗？**
A：网页版能，但内存受限，注意把「像素上限」调小；超限会直接报错而不是卡死。大图请走 CLI。

**Q：CLI 和网页版会冲突吗？**
A：不会。它们共用同一套算法与模式定义，产物逐字节互通；只是入口不同。

## 12. 已知边界

- 网页版解码走 `createImageBitmap`，颜色管理会把非 sRGB（如 Display P3）转到 sRGB，第一代一次性偏色（所有 canvas 方案都这样）。
- PNG `tRNS`（灰度 / RGB 透明色键）未处理，按不透明处理；需要透明请用 RGBA。
- 支持 8bit PNG 与 1·2·4bit 灰度 / 调色板；16bit PNG 请先无损转换。
- **跨实现互解只对单轮 `compat` 成立**：多轮 / 顺序表的产物外部工具只能手动逐步反向，不能一键解（见 [§5](#5-三种模式)）。
- **自定义 L 不做取模**：`0 ≤ L < N` 之外的值直接报错；换图（`N` 变了）后要重新确认 L，否则解出来是另一张乱码。
- CLI 输出恒为 RGBA PNG，可能比原图大；要小体积可在网页版导出 JPEG。
- 聊天软件 / 社交平台的二次压缩会破坏像素网格，这属于传输环节，任何混淆方案都救不回来。
