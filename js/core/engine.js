/**
 * 演化引擎：给定网格和规则，算下一代。
 *
 * 关键约束是「同步更新」：所有细胞都根据上一代的状态决定自己下一代的状态，
 * 先写进 next 缓冲，全部算完再整体交换。边算边改会让同一代内的结果依赖遍历顺序，
 * 那是另一种模型，不是元胞自动机。
 *
 * 另外维护一张 age 表，记录每个细胞连续存活的代数，纯粹给渲染层做颜色渐变用。
 */
export class Engine {
  /**
   * @param {import('./board.js').Board} board
   * @param {{birth: Uint8Array, survive: Uint8Array}} rule
   */
  constructor(board, rule) {
    this.board = board;
    this.rule = rule;
    this.counts = new Int16Array(board.width * board.height);
    this.age = new Uint8Array(board.width * board.height);
    this.generation = 0;
    this.stats = { births: 0, deaths: 0, population: 0 };
  }

  /** 换网格（改变尺寸时用），同步重建辅助缓冲 */
  setBoard(board) {
    this.board = board;
    this.counts = new Int16Array(board.width * board.height);
    this.age = new Uint8Array(board.width * board.height);
    this.generation = 0;
    this.stats = { births: 0, deaths: 0, population: 0 };
  }

  setRule(rule) {
    this.rule = rule;
  }

  /** 清空并归零计数，用于清屏与重新随机 */
  resetCounters() {
    this.generation = 0;
    this.age.fill(0);
    this.stats = { births: 0, deaths: 0, population: this.board.countAlive() };
  }

  /**
   * 推进一代
   * @returns {{births: number, deaths: number, population: number}}
   */
  step() {
    const board = this.board;
    const { cells, next, width: w, height: h, wrap } = board;
    const { birth, survive } = this.rule;
    const counts = this.counts;
    const age = this.age;

    // 第一遍：统计每个格子的存活邻居数
    for (let y = 0; y < h; y++) {
      const row = y * w;
      // 上下两行在非环绕模式下越界，用 -1 标记
      const rowUp = y === 0 ? (wrap ? (h - 1) * w : -1) : (y - 1) * w;
      const rowDown = y === h - 1 ? (wrap ? 0 : -1) : (y + 1) * w;

      for (let x = 0; x < w; x++) {
        const left = x === 0 ? (wrap ? w - 1 : -1) : x - 1;
        const right = x === w - 1 ? (wrap ? 0 : -1) : x + 1;
        let n = 0;

        if (rowUp >= 0) {
          if (left >= 0) n += cells[rowUp + left];
          n += cells[rowUp + x];
          if (right >= 0) n += cells[rowUp + right];
        }
        if (left >= 0) n += cells[row + left];
        if (right >= 0) n += cells[row + right];
        if (rowDown >= 0) {
          if (left >= 0) n += cells[rowDown + left];
          n += cells[rowDown + x];
          if (right >= 0) n += cells[rowDown + right];
        }

        counts[row + x] = n;
      }
    }

    // 第二遍：套规则写下一代，顺便统计出生/死亡数量
    let births = 0;
    let deaths = 0;
    let population = 0;

    for (let i = 0; i < cells.length; i++) {
      const alive = cells[i] !== 0;
      const n = counts[i];

      if (alive) {
        if (survive[n]) {
          next[i] = 1;
          if (age[i] < 255) age[i]++;
          population++;
        } else {
          next[i] = 0;
          age[i] = 0;
          deaths++;
        }
      } else if (birth[n]) {
        next[i] = 1;
        age[i] = 1;
        births++;
        population++;
      } else {
        next[i] = 0;
        age[i] = 0;
      }
    }

    board.swap();
    this.generation++;

    const stats = { births, deaths, population };
    this.stats = stats;
    return stats;
  }
}
