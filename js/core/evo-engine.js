/**
 * 演化沙盒引擎：给粒子加「复制」规则。
 *
 * 这是「生命能否从简单规则涌现」的最小可运行模型，三条规则对应讨论里的门槛：
 *   1. 复制 + 可遗传变异：能量攒到阈值就一分为二，基因组 = 亲代 × e^N(0,σ)
 *   2. 有限资源：食物是一个粗网格上的标量场，被吃掉、缓慢再生
 *   3. 代谢 + 选择：每步按 g² 消耗能量，能量归零就死
 *
 * 每个复制子带一个可遗传的标量基因组 g（采收效率）：
 *   进食 = min(可用食物, 0.15·g)，代谢 = 0.04·g²。
 * 净收益在 g≈1.9 处有内点最优 → 选择压力会把种群往这个值推。
 *
 * 本页独立、不接 worker，物理在主线程跑；种群上限 2000，短程排斥用空间网格。
 */

const TAU = Math.PI * 2;

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class EvoEngine {
  constructor(width = 1200, height = 800, options = {}) {
    this.width = width;
    this.height = height;
    const o = options;

    // 食物场：粗网格上的标量
    this.foodCols = o.foodCols ?? 60;
    this.foodRows = o.foodRows ?? 40;
    this.foodCellW = width / this.foodCols;
    this.foodCellH = height / this.foodRows;
    this.food = new Float32Array(this.foodCols * this.foodRows);

    // 可调参数
    this.foodMax = o.foodMax ?? 1;
    this.foodRegen = o.foodRegen ?? 0.02;
    this.repThreshold = o.repThreshold ?? 10;
    this.metabolismCoeff = o.metabolismCoeff ?? 0.04;
    this.mutStd = o.mutStd ?? 0.08;
    this.maxPop = o.maxPop ?? 2000;
    this.friction = o.friction ?? 0.06;
    // 随机死亡率：没有它，食物充足时种群卡在上限、没有更替，进化会停摆。
    // 它制造持续的新老更替，让「谁复制得快」真正影响谁留下。
    this.mortalityRate = o.mortalityRate ?? 0.002;
    this.repelR = 8;
    this.repelStr = 1;

    this.rng = mulberry32(o.seed ?? 20261118);

    // 动态数组
    this.capacity = 0;
    this.count = 0;
    this.x = [];
    this.y = [];
    this.vx = [];
    this.vy = [];
    this.genome = [];
    this.energy = [];
    this.ax = new Float64Array(0);
    this.ay = new Float64Array(0);

    // 初始食物：部分铺满
    for (let i = 0; i < this.food.length; i++) {
      this.food[i] = this.foodMax * (0.4 + 0.6 * this.rng());
    }
    this.foodTotal = this.food.reduce((a, b) => a + b, 0);

    this.seed(o.seedCount ?? 300);
    this.steps = 0;
  }

  _grow() {
    const next = Math.max(64, this.capacity * 2);
    for (const key of ['x', 'y', 'vx', 'vy', 'genome', 'energy']) {
      const a = new Array(next);
      for (let i = 0; i < this.count; i++) a[i] = this[key][i];
      this[key] = a;
    }
    this.ax = new Float64Array(next);
    this.ay = new Float64Array(next);
    this.capacity = next;
  }

  seed(n) {
    for (let i = 0; i < n; i++) {
      if (this.count >= this.maxPop) break;
      if (this.count >= this.capacity) this._grow();
      const k = this.count++;
      this.x[k] = this.rng() * this.width;
      this.y[k] = this.rng() * this.height;
      this.vx[k] = (this.rng() - 0.5) * 0.4;
      this.vy[k] = (this.rng() - 0.5) * 0.4;
      this.genome[k] = 0.3 + this.rng() * 0.9; // 初始 0.3..1.2
      this.energy[k] = this.repThreshold * 0.4;
    }
  }

  _cellIndex(x, y) {
    let cx = Math.floor(x / this.foodCellW);
    let cy = Math.floor(y / this.foodCellH);
    if (cx < 0) cx = 0;
    else if (cx >= this.foodCols) cx = this.foodCols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.foodRows) cy = this.foodRows - 1;
    return cy * this.foodCols + cx;
  }

  _gauss() {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.rng();
    while (v === 0) v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }

  step() {
    const count = this.count; // 本步开始时的粒子数（复制/死亡只影响 this.count）
    const repelR = this.repelR;
    const repelR2 = repelR * repelR;

    // 1. 空间分桶（短程排斥只查邻近 9 格）
    const cell = this.repelR;
    const cols = Math.max(1, Math.ceil(this.width / cell));
    const rows = Math.max(1, Math.ceil(this.height / cell));
    const buckets = this._buckets || (this._buckets = []);
    if (buckets.length !== cols * rows) {
      buckets.length = 0;
      for (let i = 0; i < cols * rows; i++) buckets.push([]);
    } else {
      for (const b of buckets) b.length = 0;
    }

    for (let i = 0; i < count; i++) {
      let cx = Math.floor(this.x[i] / cell);
      let cy = Math.floor(this.y[i] / cell);
      if (cx < 0) cx = 0;
      else if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0;
      else if (cy >= rows) cy = rows - 1;
      buckets[cy * cols + cx].push(i);
    }

    // 2. 排斥 + 进食 + 代谢
    for (let i = 0; i < count; i++) {
      const px = this.x[i];
      const py = this.y[i];
      const g = this.genome[i];
      let fx = 0;
      let fy = 0;

      let gx = Math.floor(px / cell);
      let gy = Math.floor(py / cell);
      if (gx < 0) gx = 0;
      else if (gx >= cols) gx = cols - 1;
      if (gy < 0) gy = 0;
      else if (gy >= rows) gy = rows - 1;

      for (let oy = -1; oy <= 1; oy++) {
        const cy = gy + oy;
        if (cy < 0 || cy >= rows) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const cx = gx + ox;
          if (cx < 0 || cx >= cols) continue;
          const bucket = buckets[cy * cols + cx];
          for (let b = 0; b < bucket.length; b++) {
            const j = bucket[b];
            if (j === i) continue;
            const dx = this.x[j] - px;
            const dy = this.y[j] - py;
            const d2 = dx * dx + dy * dy;
            if (d2 >= repelR2 || d2 < 1e-6) continue;
            const d = Math.sqrt(d2);
            const f = ((d / repelR - 1) * this.repelStr) / d;
            fx += dx * f;
            fy += dy * f;
          }
        }
      }
      this.ax[i] = fx;
      this.ay[i] = fy;

      // 进食：能吃的受限于所在格剩余食物
      const ci = this._cellIndex(px, py);
      const avail = this.food[ci];
      const eat = Math.min(avail, 0.15 * g);
      this.food[ci] -= eat;
      this.energy[i] += eat;
      // 代谢：采收效率的平方代价
      this.energy[i] -= this.metabolismCoeff * g * g;
    }

    // 3. 复制 / 死亡（从后往前，swap-remove 保持数组紧凑）
    for (let i = count - 1; i >= 0; i--) {
      if (this.energy[i] <= 0 || this.rng() < this.mortalityRate) {
        const last = this.count - 1;
        this.x[i] = this.x[last];
        this.y[i] = this.y[last];
        this.vx[i] = this.vx[last];
        this.vy[i] = this.vy[last];
        this.genome[i] = this.genome[last];
        this.energy[i] = this.energy[last];
        this.ax[i] = this.ax[last];
        this.ay[i] = this.ay[last];
        this.count--;
        continue;
      }
      if (this.energy[i] >= this.repThreshold && this.count < this.maxPop) {
        this.energy[i] *= 0.5;
        if (this.count >= this.capacity) this._grow();
        const k = this.count++;
        const m = Math.exp(this._gauss() * this.mutStd);
        this.genome[k] = Math.max(0.05, Math.min(2.5, this.genome[i] * m));
        this.x[k] = this.x[i] + (this.rng() - 0.5) * 6;
        this.y[k] = this.y[i] + (this.rng() - 0.5) * 6;
        this.vx[k] = (this.rng() - 0.5) * 0.4;
        this.vy[k] = (this.rng() - 0.5) * 0.4;
        this.energy[k] = this.energy[i];
        this.ax[k] = this.ax[i];
        this.ay[k] = this.ay[i];
      }
    }
    const n = this.count;

    // 4. 积分 + 边界反弹
    const damp = 1 - this.friction;
    const margin = 4;
    for (let i = 0; i < n; i++) {
      this.vx[i] = (this.vx[i] + this.ax[i]) * damp;
      this.vy[i] = (this.vy[i] + this.ay[i]) * damp;
      this.x[i] += this.vx[i];
      this.y[i] += this.vy[i];
      if (this.x[i] < margin) {
        this.x[i] = margin;
        this.vx[i] = Math.abs(this.vx[i]);
      } else if (this.x[i] > this.width - margin) {
        this.x[i] = this.width - margin;
        this.vx[i] = -Math.abs(this.vx[i]);
      }
      if (this.y[i] < margin) {
        this.y[i] = margin;
        this.vy[i] = Math.abs(this.vy[i]);
      } else if (this.y[i] > this.height - margin) {
        this.y[i] = this.height - margin;
        this.vy[i] = -Math.abs(this.vy[i]);
      }
    }

    // 5. 食物再生
    let total = 0;
    for (let c = 0; c < this.food.length; c++) {
      let v = this.food[c] + this.foodRegen;
      if (v > this.foodMax) v = this.foodMax;
      this.food[c] = v;
      total += v;
    }
    this.foodTotal = total;
    this.steps++;

    return { count: n, foodTotal: total };
  }

  /** 统计：种群、基因组均值/标准差、食物总量 */
  stats() {
    const n = this.count;
    let mean = 0;
    let sd = 0;
    for (let i = 0; i < n; i++) mean += this.genome[i];
    if (n) mean /= n;
    for (let i = 0; i < n; i++) {
      const d = this.genome[i] - mean;
      sd += d * d;
    }
    if (n) sd = Math.sqrt(sd / n);
    return {
      count: n,
      meanGenome: mean,
      sdGenome: sd,
      foodTotal: this.foodTotal,
      steps: this.steps,
    };
  }
}
