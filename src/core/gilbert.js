/**
 * Gilbert（广义 Hilbert）空间填充曲线
 *
 * 生成 0..N-1 的像素访问顺序：把 w×h 的矩形拉成一条 1D 路径，路径上相邻两点
 * 在网格上也相邻。输出 Int32Array(N)，元素是行主序像素下标 (x + y*w)。
 *
 * 取整与切分规则固定，保证同一尺寸在任何机器上得到同一条曲线：
 *  - w >= h 从 (0,0) 沿 x 轴起步，否则沿 y 轴；
 *  - 半宽用 Math.floor(ax/2)（对负数也是向下取整）；
 *  - 3 段递归使用固定入栈顺序（后进先出）。
 *
 * 性能：用扁平的 Int32Array 栈（不建 [x,y] 小数组），直线段用紧凑 while 循环，
 * 1600 万像素约 60~100 ms，内存只吃 4·N 字节。
 */

export function gilbertOrder(width, height) {
  if (!Number.isInteger(width) || width < 1) throw new RangeError(`宽度非法: ${width}`);
  if (!Number.isInteger(height) || height < 1) throw new RangeError(`高度非法: ${height}`);

  const n = width * height;
  const out = new Int32Array(n);
  let pos = 0;

  // 扁平栈，每帧 6 个 int32: x, y, ax, ay, bx, by
  let stack = new Int32Array(6 * 128);
  let sp = 0;

  const push = (x, y, ax, ay, bx, by) => {
    if (sp + 6 > stack.length) {
      const bigger = new Int32Array(stack.length * 2);
      bigger.set(stack);
      stack = bigger;
    }
    stack[sp] = x; stack[sp + 1] = y; stack[sp + 2] = ax;
    stack[sp + 3] = ay; stack[sp + 4] = bx; stack[sp + 5] = by;
    sp += 6;
  };

  if (width >= height) push(0, 0, width, 0, 0, height);
  else push(0, 0, 0, height, width, 0);

  while (sp > 0) {
    sp -= 6;
    let x = stack[sp], y = stack[sp + 1];
    let ax = stack[sp + 2], ay = stack[sp + 3];
    let bx = stack[sp + 4], by = stack[sp + 5];

    const m = Math.abs(ax + ay);
    const l = Math.abs(bx + by);
    const dax = Math.sign(ax), day = Math.sign(ay);
    const dbx = Math.sign(bx), dby = Math.sign(by);

    if (l === 1) {
      // 沿 (ax,ay) 走 m 步
      for (let i = 0; i < m; i++) {
        out[pos++] = x + y * width;
        x += dax; y += day;
      }
      continue;
    }
    if (m === 1) {
      // 沿 (bx,by) 走 l 步
      for (let i = 0; i < l; i++) {
        out[pos++] = x + y * width;
        x += dbx; y += dby;
      }
      continue;
    }

    let ax2 = Math.floor(ax / 2), ay2 = Math.floor(ay / 2);
    let bx2 = Math.floor(bx / 2), by2 = Math.floor(by / 2);
    const w2 = Math.abs(ax2 + ay2);
    const h2 = Math.abs(bx2 + by2);

    if (2 * m > 3 * l) {
      if ((w2 % 2) && m > 2) { ax2 += dax; ay2 += day; }
      // 后进先出，所以先推「后半段」
      push(x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by);
      push(x, y, ax2, ay2, bx, by);
    } else {
      if ((h2 % 2) && l > 2) { bx2 += dbx; by2 += dby; }
      push(x + (ax - dax) + (bx2 - dbx), y + (ay - day) + (by2 - dby),
        -bx2, -by2, -(ax - ax2), -(ay - ay2));
      push(x + bx2, y + by2, ax, ay, bx - bx2, by - by2);
      push(x, y, bx2, by2, ax2, ay2);
    }
  }

  if (pos !== n) throw new Error(`Gilbert 曲线长度异常: ${pos} != ${n}`);
  return out;
}
