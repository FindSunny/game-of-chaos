/**
 * 异步因果引擎：去掉全局时钟，只保留光锥。
 *
 * 与同步引擎的根本差别：
 *   - 没有「第 t 代」。每个格子有自己的本地时间戳，任何时刻屏幕上都是不同年代的拼贴。
 *   - 更新是事件：事件堆按时间弹出，同一时间按格子 id 排序，保证可复现。
 *   - 读邻居受光锥约束：距该格 d 的邻居，只有时间戳 ≤ now − d/c 的那份状态才算「已经送到」，
 *     否则只能读到它的上一版。这不是性能优化，是把因果结构写进语义。
 *
 * 两种触发方式：
 *   - period  每个格子按自己的时钟周期性更新（带抖动），最接近「被扰动的同步自动机」。
 *   - trigger 只有邻居变化时才更新，通知以 c 格/秒 向外传。没有扰动时系统会静止，
 *             这本身就是激发介质的正确行为：没有时钟，只有传播。
 *
 * 已知近似：回退只保留「上一版」状态。严格光锥下若上一版也太新，仍然会读到略超光速的信息。
 * 对演示与游戏够用；要更严格就得给每个格子存环形历史。
 */

/** 二元最小堆：按 (时间, 格子下标) 排序，保证同一时刻的处理顺序固定 */
class MinHeap {
  constructor() {
    this.times = [];
    this.cells = [];
    this.versions = [];
  }

  get size() {
    return this.times.length;
  }

  peek() {
    return this.times.length
      ? { time: this.times[0], cell: this.cells[0], version: this.versions[0] }
      : null;
  }

  push(time, cell, version) {
    const times = this.times;
    const cells = this.cells;
    const versions = this.versions;
    let i = times.length;
    times.push(time);
    cells.push(cell);
    versions.push(version);

    while (i > 0) {
      const parent = (i - 1) >> 1;
      const ordered =
        times[parent] < times[i] || (times[parent] === times[i] && cells[parent] <= cells[i]);
      if (ordered) break;
      [times[parent], times[i]] = [times[i], times[parent]];
      [cells[parent], cells[i]] = [cells[i], cells[parent]];
      [versions[parent], versions[i]] = [versions[i], versions[parent]];
      i = parent;
    }
  }

  pop() {
    const times = this.times;
    const cells = this.cells;
    const versions = this.versions;
    const top = { time: times[0], cell: cells[0], version: versions[0] };

    const lastTime = times.pop();
    const lastCell = cells.pop();
    const lastVersion = versions.pop();
    if (times.length) {
      times[0] = lastTime;
      cells[0] = lastCell;
      versions[0] = lastVersion;

      const less = (a, b) =>
        times[a] < times[b] || (times[a] === times[b] && cells[a] < cells[b]);

      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let min = i;
        if (left < times.length && less(left, min)) min = left;
        if (right < times.length && less(right, min)) min = right;
        if (min === i) break;
        [times[min], times[i]] = [times[i], times[min]];
        [cells[min], cells[i]] = [cells[i], cells[min]];
        [versions[min], versions[i]] = [versions[i], versions[min]];
        i = min;
      }
    }

    return top;
  }

  clear() {
    this.times.length = 0;
    this.cells.length = 0;
    this.versions.length = 0;
  }
}

/** 可复现随机数，测试里靠它固定调度顺序 */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ASYNC_DEFAULTS = {
  mode: 'period', // period | trigger
  strictCone: true, // 是否禁止超光速读取
  rate: 2, // 每格平均每秒更新次数（period 模式）
  c: 1, // 光速：格 / 秒
  jitter: 0.6, // 周期抖动比例，0 表示步调完全一致
  seed: 20261110,
  maxEventsPerFrame: 6000,
};

export class AsyncLifeEngine {
  /**
   * @param {import('./board.js').Board} board
   * @param {{birth: Uint8Array, survive: Uint8Array}} rule
   * @param {Partial<typeof ASYNC_DEFAULTS>} options
   */
  constructor(board, rule, options = {}) {
    this.board = board;
    this.rule = rule;
    this.options = { ...ASYNC_DEFAULTS, ...options };
    this.rng = mulberry32(this.options.seed);
    this.allocate(board);
  }

  allocate(board) {
    const n = board.width * board.height;
    this.heap = new MinHeap();
    this.age = new Uint8Array(n); // 给渲染层复用，语义是「连续存活的事件数」
    this.due = new Float64Array(n); // 下一次计划时间
    this.version = new Uint32Array(n); // 排期版本号，用来丢弃被覆盖的旧条目
    this.stamp = new Float64Array(n); // 本地时间戳：这个状态是什么时候写下的
    this.prev = new Uint8Array(n); // 上一版状态，供光锥回退
    this.prevStamp = new Float64Array(n);
    this.firstChange = new Float64Array(n).fill(Infinity);
    this.reset();
  }

  setBoard(board) {
    this.board = board;
    this.allocate(board);
  }

  /**
   * 改参数。切换触发方式会让旧队列失效，需要重新播种。
   * @param {Partial<typeof ASYNC_DEFAULTS>} options
   */
  setOptions(options) {
    const modeChanged = options.mode && options.mode !== this.options.mode;
    this.options = { ...this.options, ...options };
    if (modeChanged) this.reset();
  }

  /** 重新播种：清空队列，把每个格子按当前模式排进堆 */
  reset() {
    const n = this.board.width * this.board.height;
    const { mode, rate, c, jitter } = this.options;

    this.heap.clear();
    this.due.fill(Infinity);
    this.version.fill(0);
    this.stamp.fill(0);
    this.prevStamp.fill(0);
    this.age.fill(0);
    this.firstChange.fill(Infinity);
    this.prev.set(this.board.cells);
    this.simTime = 0;
    this.updates = 0;
    this.lastBirths = 0;
    this.lastDeaths = 0;

    for (let i = 0; i < n; i++) {
      // 周期模式：初始相位随机撒在一个周期内，避免全体同时开火
      // 触发模式：给每个格子一个随机的小延迟，作为第一波扰动
      const phase =
        mode === 'period'
          ? this.rng() * (1 / rate) * Math.max(jitter, 0.05)
          : this.rng() / c;
      this.schedule(i, phase);
    }

    this.stats = this.buildStats();
  }

  resetCounters() {
    this.reset();
  }

  get generation() {
    return this.updates;
  }

  /** 安排一次更新，只有更早的时间才有意义；版本号用来让旧条目自动失效 */
  schedule(index, time) {
    if (time < this.due[index]) {
      this.due[index] = time;
      this.version[index]++;
      this.heap.push(time, index, this.version[index]);
    }
  }

  /** 周期模式的下一拍 */
  nextInterval() {
    const base = 1 / this.options.rate;
    const jitter = this.options.jitter;
    return base * (1 + jitter * (this.rng() * 2 - 1));
  }

  /**
   * 读一个邻居「此刻能看到的」状态
   * @param {number} index 邻居下标
   * @param {number} now 当前事件时间
   * @param {number} distance 距离（摩尔邻域统一为 1）
   */
  readState(index, now, distance) {
    const cells = this.board.cells;
    if (!this.options.strictCone) return cells[index] ? 1 : 0;

    const cutoff = now - distance / this.options.c;
    if (this.stamp[index] <= cutoff) return cells[index] ? 1 : 0;
    // 邻居刚更新过，那份信息还在路上，只能看它的上一版
    return this.prev[index] ? 1 : 0;
  }

  /** 统计八邻域存活数（受光锥约束） */
  countNeighbors(index, now) {
    const board = this.board;
    const w = board.width;
    const h = board.height;
    const wrap = board.wrap;
    const x = index % w;
    const y = (index - x) / w;
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
        n += this.readState(ny * w + nx, now, 1);
      }
    }

    return n;
  }

  /** 处理一次更新事件 */
  process(index, now) {
    const cells = this.board.cells;
    const alive = cells[index] !== 0;
    const n = this.countNeighbors(index, now);
    const next = alive ? (this.rule.survive[n] ? 1 : 0) : this.rule.birth[n] ? 1 : 0;

    const old = cells[index];
    this.prev[index] = old;
    this.prevStamp[index] = this.stamp[index];

    if (next !== old) {
      cells[index] = next;
      if (next) {
        this.lastBirths++;
        this.age[index] = 1;
      } else {
        this.lastDeaths++;
        this.age[index] = 0;
      }
      if (this.firstChange[index] === Infinity) this.firstChange[index] = now;

      // 触发模式：只把变化传给邻居，传播速度就是 c
      if (this.options.mode === 'trigger') this.notifyNeighbors(index, now);
    } else if (next === 1) {
      if (this.age[index] < 255) this.age[index]++;
    }

    this.stamp[index] = now;
    this.updates++;

    // 处理完把排期清空，否则 nextInterval 一定比旧 due 晚，会被 schedule 的「更早」判断挡掉
    this.due[index] = Infinity;
    if (this.options.mode === 'period') {
      this.schedule(index, now + this.nextInterval());
    }
  }

  notifyNeighbors(index, now) {
    const board = this.board;
    const w = board.width;
    const h = board.height;
    const wrap = board.wrap;
    const x = index % w;
    const y = (index - x) / w;

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
        this.schedule(ny * w + nx, now + 1 / this.options.c);
      }
    }
  }

  /**
   * 推进仿真时间
   * @param {number} dt 新增的仿真秒数
   * @returns {object} 本批统计
   */
  advance(dt) {
    if (!(dt > 0)) return this.stats;

    const target = this.simTime + dt;
    const budget = this.options.maxEventsPerFrame;
    let processed = 0;

    this.lastBirths = 0;
    this.lastDeaths = 0;

    while (this.heap.size && processed < budget) {
      const top = this.heap.peek();
      if (top.time > target) break;
      const ev = this.heap.pop();
      // 被后来的排期覆盖过的条目直接丢弃
      if (ev.version !== this.version[ev.cell]) continue;
      this.process(ev.cell, ev.time);
      processed++;
    }

    // 事件积压时不要硬把时间推过去，否则队列会越积越多
    if (processed >= budget && this.heap.size) {
      this.simTime = Math.max(this.simTime, this.heap.peek().time);
    } else {
      this.simTime = target;
    }

    this.stats = this.buildStats();
    return this.stats;
  }

  buildStats() {
    return {
      births: this.lastBirths,
      deaths: this.lastDeaths,
      updates: this.updates,
      population: this.board.countAlive(),
      simTime: this.simTime,
      queue: this.heap.size,
      maxLag: this.computeMaxLag(),
    };
  }

  /** 最老的格子落后当前时间多少秒，用来判断「时间差」有多大 */
  computeMaxLag() {
    let max = 0;
    const now = this.simTime;
    for (let i = 0; i < this.stamp.length; i++) {
      const lag = now - this.stamp[i];
      if (lag > max) max = lag;
    }
    return max;
  }
}
