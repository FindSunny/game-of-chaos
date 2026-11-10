/**
 * 细胞网格：只负责存状态，不做渲染、不做规则计算。
 *
 * 用两个 TypedArray 做双缓冲（当前代 / 下一代），引擎每步计算完交换引用，
 * 保证「隔代同时更新」——这是元胞自动机的硬性前提，不能边算边改。
 *
 * 状态值目前是 0/1，但接口按「非 0 即活」写，
 * 后续要做五状态生克（木火土金水）时，同一份结构可直接承载多值。
 */
export class Board {
  /**
   * @param {number} width  横向格数
   * @param {number} height 纵向格数
   * @param {boolean} wrap  边界是否环绕（环面）。false 时界外视为死亡
   */
  constructor(width = 160, height = 100, wrap = true) {
    this.width = width;
    this.height = height;
    this.wrap = wrap;
    this.cells = new Uint8Array(width * height);
    this.next = new Uint8Array(width * height);
  }

  /** 坐标转下标，界外返回 -1 */
  index(x, y) {
    if (this.wrap) {
      x = (x + this.width) % this.width;
      y = (y + this.height) % this.height;
    } else if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return -1;
    }
    return y * this.width + x;
  }

  get(x, y) {
    const i = this.index(x, y);
    return i < 0 ? 0 : this.cells[i];
  }

  set(x, y, value) {
    const i = this.index(x, y);
    if (i >= 0) this.cells[i] = value;
  }

  clear() {
    this.cells.fill(0);
    this.next.fill(0);
  }

  /**
   * 随机撒点
   * @param {number} density 0~1，存活比例
   * @param {() => number} rng 可注入随机源，测试时用来固定结果
   */
  randomize(density = 0.3, rng = Math.random) {
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i] = rng() < density ? 1 : 0;
    }
    this.next.fill(0);
  }

  countAlive() {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] !== 0) n++;
    return n;
  }

  /** 交换双缓冲：一步算完才真正把「下一代」变成「当前代」 */
  swap() {
    const t = this.cells;
    this.cells = this.next;
    this.next = t;
  }

  /**
   * 改变尺寸，保留左上角重叠区域的内容
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    const next = new Board(width, height, this.wrap);
    const w = Math.min(width, this.width);
    const h = Math.min(height, this.height);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        next.cells[y * width + x] = this.cells[y * this.width + x];
      }
    }
    this.width = width;
    this.height = height;
    this.cells = next.cells;
    this.next = next.next;
  }
}
