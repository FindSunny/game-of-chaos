/**
 * 稀疏世界：只存活细胞，坐标可以是负数，没有边界。
 *
 * 生命游戏天生稀疏——死区只要周围没有活细胞就永远是死的，所以没必要为整个平面分配内存。
 * 用 Map<number, 1> 存活的格子，键由 (x, y) 打包成一个整数。
 *
 * 坐标范围 ±(2^20)，大约 ±104 万格，对沙盒足够；超出会被钳制。
 */

const OFFSET = 1 << 20;
const SPAN = OFFSET * 2 + 1;

/** 打包坐标；越界时钳制，避免键冲突 */
export function keyOf(x, y) {
  const cx = Math.max(-OFFSET, Math.min(OFFSET, x | 0));
  const cy = Math.max(-OFFSET, Math.min(OFFSET, y | 0));
  return (cx + OFFSET) * SPAN + (cy + OFFSET);
}

export function xOf(key) {
  return Math.floor(key / SPAN) - OFFSET;
}

export function yOf(key) {
  return (key % SPAN) - OFFSET;
}

export class SparseWorld {
  constructor() {
    this.isSparse = true;
    this.cells = new Map(); // key → 1
  }

  get(x, y) {
    return this.cells.has(keyOf(x, y)) ? 1 : 0;
  }

  has(x, y) {
    return this.cells.has(keyOf(x, y));
  }

  set(x, y, value) {
    const key = keyOf(x, y);
    if (value) this.cells.set(key, 1);
    else this.cells.delete(key);
  }

  clear() {
    this.cells.clear();
  }

  countAlive() {
    return this.cells.size;
  }

  /**
   * 在指定中心周围撒一片随机活细胞
   * @param {number} density 0~1
   * @param {() => number} rng
   * @param {number} cx 中心 x
   * @param {number} cy 中心 y
   * @param {number} width 撒点宽度（格）
   * @param {number} height 撒点高度（格）
   */
  randomize(density = 0.3, rng = Math.random, cx = 0, cy = 0, width = 120, height = 80) {
    this.cells.clear();
    const x0 = cx - Math.floor(width / 2);
    const y0 = cy - Math.floor(height / 2);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (rng() < density) this.cells.set(keyOf(x0 + x, y0 + y), 1);
      }
    }
  }

  /** 遍历所有活细胞，回调 (x, y) */
  forEachAlive(fn) {
    for (const key of this.cells.keys()) fn(xOf(key), yOf(key));
  }
}
