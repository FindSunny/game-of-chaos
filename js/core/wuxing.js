/**
 * 五行生克元胞自动机。
 *
 * 与生命游戏的根本差别是状态空间：活/死两态换成「空 + 五行」六态。
 * 局部规则仍然只看八邻域，同步更新，边界处理与生命游戏一致。
 *
 * 状态编码（下标即状态值）：
 *   0 空 · 1 木 · 2 火 · 3 土 · 4 金 · 5 水
 *
 * 相生：木→火→土→金→水→木，即 succ(s) = s % 5 + 1
 * 相克：木克土、土克水、水克火、火克金、金克木，
 *       即 ke(s) = (s + 1) % 5 + 1
 *       （木 1 克 土 3，火 2 克 金 4，土 3 克 水 5，水 5 克 火 2，金 4 克 木 1）
 *
 * 规则三条，按优先级执行：
 *   1. 克制（活→空）：邻域里「克我者」够多且多于「生我者」，此格被灭。
 *   2. 生长（空→活）：邻域里某元素够多、且沒被它的克星压住，空格长出它「所生」之物。
 *   3. 转化（活→活）：邻域里「生我者」够多且多于「克我者」，此格推进到「我生」之物。
 * 三条都不满足则保持原状。
 *
 * 这三条只是「生克关系」的一种形式化，不是五行理论本身——
 * 参数一换，收敛、循环、爆发都能出现，这正是把它做成沙盒的原因。
 */

/** 五行元数据，下标与状态值对应，0 表示空 */
export const WUXING_STATES = [
  { value: 0, name: '空', color: null },
  { value: 1, name: '木', color: '#4ade80' },
  { value: 2, name: '火', color: '#f87171' },
  { value: 3, name: '土', color: '#fbbf24' },
  { value: 4, name: '金', color: '#e2e8f0' },
  { value: 5, name: '水', color: '#38bdf8' },
];

/** 我生者：木生火，即 1→2、5→1 */
export function succ(state) {
  return (state % 5) + 1;
}

/** 生我者：火的母是木，即 2→1、1→5 */
export function pred(state) {
  return ((state + 3) % 5) + 1;
}

/** 我克者：木克土，即 1→3、5→2 */
export function ke(state) {
  return ((state + 1) % 5) + 1;
}

/** 克我者：土的克星是木，即 3→1、1→4 */
export function keOf(state) {
  return ((state + 2) % 5) + 1;
}

export const DEFAULT_OPTIONS = {
  grow: 3, // 生长/转化阈值
  kill: 3, // 克制阈值
};

/**
 * 三档动力学预设。
 *
 * 参数平面上有一条很陡的相变：生长阈值 ≥3 时系统停在稀疏地块，降到 2 就会迅速铺满，
 * 克制阈值再把「铺满之后」分成同心环和翻腾噪点两种形态。
 * 三档就取在这条相变线的三侧，保证一眼能看出差别。
 */
export const PARAM_PRESETS = [
  { id: 'world', label: '地块', grow: 3, kill: 3, hint: '稀疏，边界缓慢侵蚀' },
  { id: 'ripple', label: '涟漪', grow: 2, kill: 4, hint: '铺满棋盘，同心环状推进' },
  { id: 'boil', label: '沸腾', grow: 2, kill: 2, hint: '铺满后持续翻腾，结构被打散' },
];

/**
 * 五行区块初始化：每种元素撒几个圆斑，其余留空。
 *
 * 随机撒点（每格独立掷骰）在五态下会退化成彩色噪点——邻域里同态太少，
 * 规则每次都被噪声决定。成块的初始状态才有「域」可生长、有边界可移动，
 * 这也是它在视觉上像「世界地图」的原因。
 *
 * @param {import('./board.js').Board} board
 * @param {number} density 目标占据率 0~1，用来推算斑块数量与半径
 * @param {() => number} rng
 */
export function seedWorld(board, density = 0.3, rng = Math.random) {
  board.clear();

  const area = board.width * board.height;
  const perState = Math.max(2, Math.round(density * 10));
  const totalBlobs = perState * 5;
  const radius = Math.min(
    12,
    Math.max(3, Math.round(Math.sqrt((density * area) / (totalBlobs * Math.PI)))),
  );

  for (let state = 1; state <= 5; state++) {
    for (let b = 0; b < perState; b++) {
      const cx = Math.floor(rng() * board.width);
      const cy = Math.floor(rng() * board.height);
      // 每个斑块给一个自己的形变系数，正圆看起来像骰子点数，扰动之后更像地块
      const wobble = 0.7 + rng() * 0.6;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const dist2 = dx * dx + dy * dy;
          if (dist2 > radius * radius * wobble) continue;
          const x = (cx + dx + board.width) % board.width;
          const y = (cy + dy + board.height) % board.height;
          board.cells[y * board.width + x] = state;
        }
      }
    }
  }

  // 少量散点，打破完全对称，给边界一点随机扰动
  const specks = Math.round(area * 0.004);
  for (let i = 0; i < specks; i++) {
    const x = Math.floor(rng() * board.width);
    const y = Math.floor(rng() * board.height);
    board.cells[y * board.width + x] = 1 + Math.floor(rng() * 5);
  }

  return { perState, radius };
}

/**
 * 逐格随机撒五行，会变成噪点，保留给「想直接看混沌」的场景
 * @param {import('./board.js').Board} board
 * @param {number} density
 * @param {() => number} rng
 */
export function scatterStates(board, density = 0.3, rng = Math.random) {
  board.clear();
  for (let i = 0; i < board.cells.length; i++) {
    board.cells[i] = rng() < density ? 1 + Math.floor(rng() * 5) : 0;
  }
}

export class WuxingEngine {
  /**
   * @param {import('./board.js').Board} board
   * @param {{grow: number, kill: number}} options
   */
  constructor(board, options = {}) {
    this.board = board;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.stateCounts = new Int32Array(6);
    this.neighborBuf = new Int32Array(8);
    this.age = new Uint8Array(board.width * board.height);
    this.generation = 0;

    // 每代的流量统计，供「五行流向环」使用：
    //   bornFrom[g]  本代因元素 g 而诞生的格子数（体现 g → succ(g) 这条生）
    //   advanced[s]  本代从 s 推进到 succ(s) 的格子数
    //   killedBy[k]  本代被元素 k 克死的格子数（体现 k → ke(k) 这条克）
    //   totals[v]    演化完成后各状态的格子数（含 totals[0] 的空）
    // 这些数组每步复用，读取方要在下一次 step 之前读完。
    this.flows = {
      bornFrom: new Uint32Array(6),
      advanced: new Uint32Array(6),
      killedBy: new Uint32Array(6),
      totals: new Int32Array(6),
    };

    this.stats = {
      births: 0,
      deaths: 0,
      transitions: 0,
      population: board.countAlive(),
      flows: this.flows,
    };
  }

  setBoard(board) {
    this.board = board;
    this.age = new Uint8Array(board.width * board.height);
    this.neighborBuf = new Int32Array(8);
    this.generation = 0;
    this.stats = {
      births: 0,
      deaths: 0,
      transitions: 0,
      population: board.countAlive(),
      flows: this.flows,
    };
  }

  setOptions(options) {
    this.options = { ...this.options, ...options };
  }

  resetCounters() {
    this.generation = 0;
    this.age.fill(0);
    for (const key of Object.keys(this.flows)) this.flows[key].fill(0);
    this.stats = {
      births: 0,
      deaths: 0,
      transitions: 0,
      population: this.board.countAlive(),
      flows: this.flows,
    };
  }

  /**
   * 收集八邻域下标，越界（非环绕）的跳过
   * @returns {number} 实际数量
   */
  collectNeighbors(x, y) {
    const board = this.board;
    const { width: w, height: h, wrap } = board;
    const out = this.neighborBuf;
    let n = 0;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        let nx = x + dx;
        let ny = y + dy;
        if (wrap) {
          nx = (nx + w) % w;
          ny = (ny + h) % h;
        } else if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          continue;
        }
        out[n++] = ny * w + nx;
      }
    }
    return n;
  }

  /**
   * 推进一代，返回本代的统计量
   * @returns {{births: number, deaths: number, transitions: number, population: number}}
   */
  step() {
    const board = this.board;
    const { cells, next, width: w, height: h } = board;
    const counts = this.stateCounts;
    const age = this.age;
    const { grow, kill } = this.options;
    const { bornFrom, advanced, killedBy, totals } = this.flows;
    bornFrom.fill(0);
    advanced.fill(0);
    killedBy.fill(0);
    totals.fill(0);

    let births = 0;
    let deaths = 0;
    let transitions = 0;
    let population = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const state = cells[i];

        counts.fill(0);
        const n = this.collectNeighbors(x, y);
        for (let k = 0; k < n; k++) counts[cells[this.neighborBuf[k]]]++;

        let result = state;

        if (state === 0) {
          // 生长：挑邻居里数量最多、达到阈值、且压得住自己克星的元素
          let parent = 0;
          let best = 0;
          for (let g = 1; g <= 5; g++) {
            const c = counts[g];
            if (c < grow || c <= best) continue;
            if (c <= counts[ke(g)]) continue;
            parent = g;
            best = c;
          }
          if (parent !== 0) {
            result = succ(parent);
            births++;
            bornFrom[parent]++;
          }
        } else {
          const supporter = pred(state); // 生我者
          const killer = keOf(state); // 克我者
          const supporters = counts[supporter];
          const suppressors = counts[killer];

          if (suppressors >= kill && suppressors > supporters) {
            result = 0;
            deaths++;
            killedBy[killer]++;
          } else if (supporters >= grow && supporters > suppressors) {
            result = succ(state);
            transitions++;
            advanced[state]++;
          }
        }

        next[i] = result;
        totals[result]++;
        if (result !== 0) {
          population++;
          age[i] = result === state ? Math.min(255, age[i] + 1) : 1;
        } else {
          age[i] = 0;
        }
      }
    }

    board.swap();
    this.generation++;

    this.stats = { births, deaths, transitions, population, flows: this.flows };
    return this.stats;
  }
}
