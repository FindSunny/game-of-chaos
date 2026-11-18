/**
 * 生命体实验 · 第一步：黏性粒子个体。
 *
 * 目标：验证「有形状的结构」能否稳定地自我复制——不做变异、不做选择。
 *
 * 规则：
 *   1. 同色粒子中程吸引 + 近程软核排斥 → 结成有边界的「团块」（= 个体）
 *   2. 不同色之间轻微排斥 → 各自的团块不粘连
 *   3. 个体吃食物攒能量；能量够就「出芽」长出一个同色子粒子，团块长大
 *   4. 团块超过阈值 → 沿质心一分为二（= 繁殖出两个同色子个体）
 *   5. 能量耗尽粒子死亡，团块随之解体；食物缓慢再生
 *
 * 「个体」= 同色且互相靠近的连通分量。稳定自复制的判据：
 *   团块既不散架、也不无限膨胀，能反复分裂成尺寸相近的新团块。
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

export class ColonyEngine {
  constructor(width = 1200, height = 800, options = {}) {
    this.width = width;
    this.height = height;
    const o = options;

    // 食物场（粗网格标量）
    this.foodCols = o.foodCols ?? 60;
    this.foodRows = o.foodRows ?? 40;
    this.foodCellW = width / this.foodCols;
    this.foodCellH = height / this.foodRows;
    this.food = new Float32Array(this.foodCols * this.foodRows);

    // 力与结构参数（基线值；每个物种可以有自己的偏离）
    this.baseAttract = o.attract ?? 0.06; // 同色中程吸引强度
    this.attractR = o.attractR ?? 40; // 吸引作用半径
    this.repel = o.repel ?? 1; // 软核排斥强度
    this.repelR = 8; // 软核半径
    this.crossRepel = o.crossRepel ?? 0.02; // 保留：异色排斥强度（旧，未用）
    this.crossAttract = o.crossAttract ?? 0.1; // 异色相互作用强度
    this.crossR = o.crossR ?? 24; // 异色作用半径
    this.bondR = o.bondR ?? 24; // 判定「属于同一个体」的键距
    this.maxSize = o.maxSize ?? 60; // 团块超过这个尺寸就分裂

    // 能量与繁殖（已调到「食物充足 → 团块稳定繁殖」的平衡点）
    this.foodMax = o.foodMax ?? 2;
    this.foodRegen = o.foodRegen ?? 0.2;
    this.harvest = o.harvest ?? 0.04; // 每步从所在格摄取的能量上限
    this.baseMetabolism = o.metabolism ?? 0.01; // 每步代谢（基线）
    this.budThreshold = o.budThreshold ?? 4; // 能量够就出芽
    this.mortalityRate = o.mortalityRate ?? 0.001; // 少量随机死亡，防止系统冻结
    this.maxPop = o.maxPop ?? 3000;

    // 第二步：形态遗传 + 变异
    this.mutStd = o.mutStd ?? 0; // 变异强度（0 = 关，纯第一步行为）
    this.mutProb = o.mutProb ?? 0.4; // 分裂时子代变异成新物种的概率
    this.maxSpecies = o.maxSpecies ?? 48;

    this.friction = o.friction ?? 0.06;
    this.splitInterval = o.splitInterval ?? 30; // 每隔多少步做一次分裂
    this.chemotaxis = o.chemotaxis ?? 0.15; // 趋化强度：往食物浓度高的方向游

    this.rng = mulberry32(o.seed ?? 20261118);

    this.capacity = 0;
    this.count = 0;
    this.x = [];
    this.y = [];
    this.vx = [];
    this.vy = [];
    this.type = [];
    this.energy = [];
    this.ax = new Float64Array(0);
    this.ay = new Float64Array(0);

    for (let i = 0; i < this.food.length; i++) {
      this.food[i] = this.foodMax * (0.4 + 0.6 * this.rng());
    }
    this.foodTotal = this.food.reduce((a, b) => a + b, 0);

    // 物种：每个物种一个可遗传基因组 { attract, metabolism, color }
    this.species = [];
    // 物种间键矩阵 bond[i][j]：对角线 = 1（同物种凝聚），非对角正负随机
    this.bond = [];
    const n0 = o.species ?? 6;
    for (let i = 0; i < n0; i++) this._newSpecies();

    this.seed(o.seedCount ?? 300);
    this.steps = 0;
    this.individuals = 0;
  }

  /** 随机键值：高斯扰动夹在 ±0.6，正吸引负排斥 */
  _randomBond() {
    let v = this._gauss() * 0.3;
    if (v > 0.6) v = 0.6;
    else if (v < -0.6) v = -0.6;
    return v;
  }

  /** 重掷物种间键矩阵（对角线保持 1） */
  randomizeBonds() {
    const n = this.species.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        this.bond[i][j] = this._randomBond();
      }
    }
  }

  /** 新建一个物种，返回其 id；颜色按黄金角取，保证彼此区分 */
  _newSpecies(attract, metabolism) {
    const id = this.species.length;
    const hue = Math.round((id * 137.508) % 360);
    this.species.push({
      attract: attract ?? this.baseAttract,
      metabolism: metabolism ?? this.baseMetabolism,
      color: `hsl(${hue}, 70%, 55%)`,
    });
    // 扩展键矩阵：新物种与已有物种各得一个随机键，对角线 = 1
    const row = new Array(id + 1);
    for (let j = 0; j < id; j++) row[j] = this._randomBond();
    row[id] = 1;
    this.bond.push(row);
    for (let i = 0; i < id; i++) this.bond[i].push(this._randomBond());
    return id;
  }

  _grow() {
    const next = Math.max(64, this.capacity * 2);
    for (const key of ['x', 'y', 'vx', 'vy', 'type', 'energy']) {
      const a = new Array(next);
      for (let i = 0; i < this.count; i++) a[i] = this[key][i];
      this[key] = a;
    }
    this.ax = new Float64Array(next);
    this.ay = new Float64Array(next);
    this.capacity = next;
  }

  _push(type, x, y, energy, vx = 0, vy = 0) {
    if (this.count >= this.maxPop) return -1;
    if (this.count >= this.capacity) this._grow();
    const k = this.count++;
    this.type[k] = type;
    this.x[k] = x;
    this.y[k] = y;
    this.vx[k] = vx;
    this.vy[k] = vy;
    this.energy[k] = energy;
    return k;
  }

  seed(n) {
    for (let i = 0; i < n; i++) {
      const type = Math.floor(this.rng() * this.species.length);
      this._push(type, this.rng() * this.width, this.rng() * this.height, this.budThreshold * 0.5);
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

  /** 食物浓度梯度（归一化前的方向）：比较左右、上下相邻格 */
  _foodGradient(x, y) {
    const ci = this._cellIndex(x, y);
    const cx = ci % this.foodCols;
    const cy = Math.floor(ci / this.foodCols);
    const f = (cxi, cyi) => this.food[cyi * this.foodCols + cxi];
    const fl = f(Math.max(0, cx - 1), cy);
    const fr = f(Math.min(this.foodCols - 1, cx + 1), cy);
    const fu = f(cx, Math.max(0, cy - 1));
    const fd = f(cx, Math.min(this.foodRows - 1, cy + 1));
    return { gx: fr - fl, gy: fd - fu };
  }

  _gauss() {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.rng();
    while (v === 0) v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }

  /** 用键距建桶；供力量计算和连通分量复用 */
  _buckets() {
    const cell = this.bondR;
    const cols = Math.max(1, Math.ceil(this.width / cell));
    const rows = Math.max(1, Math.ceil(this.height / cell));
    const buckets = this._bucketsArr || (this._bucketsArr = []);
    if (buckets.length !== cols * rows) {
      buckets.length = 0;
      for (let i = 0; i < cols * rows; i++) buckets.push([]);
    } else {
      for (const b of buckets) b.length = 0;
    }
    for (let i = 0; i < this.count; i++) {
      let cx = Math.floor(this.x[i] / cell);
      let cy = Math.floor(this.y[i] / cell);
      if (cx < 0) cx = 0;
      else if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0;
      else if (cy >= rows) cy = rows - 1;
      buckets[cy * cols + cx].push(i);
    }
    this._cols = cols;
    this._rows = rows;
    return buckets;
  }

  step() {
    const count = this.count;
    const cols = this._cols || 1;
    const rows = this._rows || 1;
    const buckets = this._buckets();

    // 1. 力（同色吸引+软核，异色排斥）
    for (let i = 0; i < count; i++) {
      const px = this.x[i];
      const py = this.y[i];
      const ti = this.type[i];
      let fx = 0;
      let fy = 0;

      let gx = Math.floor(px / this.bondR);
      let gy = Math.floor(py / this.bondR);
      if (gx < 0) gx = 0;
      else if (gx >= cols) gx = cols - 1;
      if (gy < 0) gy = 0;
      else if (gy >= rows) gy = rows - 1;

      // 吸引半径 40 > 键距 24，需要 ±2 格
      const reachCells = Math.ceil(this.attractR / this.bondR);
      for (let oy = -reachCells; oy <= reachCells; oy++) {
        const cy = gy + oy;
        if (cy < 0 || cy >= rows) continue;
        for (let ox = -reachCells; ox <= reachCells; ox++) {
          const cx = gx + ox;
          if (cx < 0 || cx >= cols) continue;
          const bucket = buckets[cy * cols + cx];
          for (let b = 0; b < bucket.length; b++) {
            const j = bucket[b];
            if (j === i) continue;
            const dx = this.x[j] - px;
            const dy = this.y[j] - py;
            const d2 = dx * dx + dy * dy;
            const same = this.type[j] === ti;

            if (d2 < this.repelR * this.repelR) {
              // 软核排斥，任何类型都推
              if (d2 < 1e-6) continue;
              const d = Math.sqrt(d2);
              const f = ((d / this.repelR - 1) * this.repel) / d;
              fx += dx * f;
              fy += dy * f;
              continue;
            }

            if (same) {
              if (d2 < this.attractR * this.attractR) {
                const d = Math.sqrt(d2);
                const t = (d - this.repelR) / (this.attractR - this.repelR);
                const f = (this.species[ti].attract * (1 - t)) / d;
                fx += dx * f;
                fy += dy * f;
              }
            } else if (d2 < this.crossR * this.crossR) {
              // 异色：按物种间键矩阵，正吸引、负排斥
              const d = Math.sqrt(d2);
              const b = this.bond[ti][this.type[j]];
              const f = (b * this.crossAttract) / d;
              fx += dx * f;
              fy += dy * f;
            }
          }
        }
      }
      // 趋化：往食物浓度高的方向游，团块才有「觅食迁移」的净位移
      if (this.chemotaxis > 0) {
        const grad = this._foodGradient(px, py);
        const glen = Math.hypot(grad.gx, grad.gy);
        if (glen > 1e-4) {
          fx += (grad.gx / glen) * this.chemotaxis;
          fy += (grad.gy / glen) * this.chemotaxis;
        }
      }

      this.ax[i] = fx;
      this.ay[i] = fy;
    }

    // 2. 进食 + 代谢
    for (let i = 0; i < count; i++) {
      const ci = this._cellIndex(this.x[i], this.y[i]);
      const avail = this.food[ci];
      const eat = Math.min(avail, this.harvest);
      this.food[ci] -= eat;
      this.energy[i] += eat;
      this.energy[i] -= this.species[this.type[i]].metabolism;
    }

    // 3. 出芽 + 死亡
    for (let i = count - 1; i >= 0; i--) {
      if (this.energy[i] <= 0 || this.rng() < this.mortalityRate) {
        const last = this.count - 1;
        this.x[i] = this.x[last];
        this.y[i] = this.y[last];
        this.vx[i] = this.vx[last];
        this.vy[i] = this.vy[last];
        this.type[i] = this.type[last];
        this.energy[i] = this.energy[last];
        this.ax[i] = this.ax[last];
        this.ay[i] = this.ay[last];
        this.count--;
        continue;
      }
      if (this.energy[i] >= this.budThreshold && this.count < this.maxPop) {
        this.energy[i] *= 0.5;
        this._push(
          this.type[i],
          this.x[i] + (this.rng() - 0.5) * 10,
          this.y[i] + (this.rng() - 0.5) * 10,
          this.energy[i],
          (this.rng() - 0.5) * 0.3,
          (this.rng() - 0.5) * 0.3,
        );
      }
    }

    // 4. 周期性分裂大团块
    if (this.steps % this.splitInterval === 0) {
      this._split();
    }

    // 5. 积分 + 边界反弹
    const n = this.count;
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

    // 6. 食物再生
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

  /** 连通分量：同色且键距内的粒子算一个个体。返回 [[粒子索引], ...] */
  _components() {
    const n = this.count;
    if (n === 0) return [];

    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (a) => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };

    const buckets = this._buckets();
    const cols = this._cols;
    const rows = this._rows;
    for (let i = 0; i < n; i++) {
      const gx = Math.min(cols - 1, Math.max(0, Math.floor(this.x[i] / this.bondR)));
      const gy = Math.min(rows - 1, Math.max(0, Math.floor(this.y[i] / this.bondR)));
      for (let oy = -1; oy <= 1; oy++) {
        const cy = gy + oy;
        if (cy < 0 || cy >= rows) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const cx = gx + ox;
          if (cx < 0 || cx >= cols) continue;
          const bucket = buckets[cy * cols + cx];
          for (let b = 0; b < bucket.length; b++) {
            const j = bucket[b];
            if (j <= i) continue;
            if (this.type[j] !== this.type[i]) continue;
            const dx = this.x[j] - this.x[i];
            const dy = this.y[j] - this.y[i];
            if (dx * dx + dy * dy < this.bondR * this.bondR) union(i, j);
          }
        }
      }
    }

    const comps = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      let arr = comps.get(r);
      if (!arr) {
        arr = [];
        comps.set(r, arr);
      }
      arr.push(i);
    }
    return [...comps.values()];
  }

  /** 把超过 maxSize 的团块沿质心一分为二 */
  _split() {
    const comps = this._components();
    let individualCount = 0;
    for (const members of comps) {
      if (members.length <= this.maxSize) {
        individualCount++;
        continue;
      }
      let cx = 0;
      let cy = 0;
      for (const m of members) {
        cx += this.x[m];
        cy += this.y[m];
      }
      cx /= members.length;
      cy /= members.length;

      const angle = this.rng() * TAU;
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const imp = 1.2;

      const half = members.length >> 1;
      members.sort((a, b) => {
        const da = (this.x[a] - cx) * ux + (this.y[a] - cy) * uy;
        const db = (this.x[b] - cx) * ux + (this.y[b] - cy) * uy;
        return da - db;
      });

      // 第二步：变异。子代之一可能变成一个基因组略有偏离的新物种
      if (this.mutStd > 0 && this.species.length < this.maxSpecies && this.rng() < this.mutProb) {
        const parentSp = this.species[this.type[members[0]]];
        const child = this._newSpecies(
          parentSp.attract * Math.exp(this._gauss() * this.mutStd),
          parentSp.metabolism * Math.exp(this._gauss() * this.mutStd),
        );
        for (let k = half; k < members.length; k++) this.type[members[k]] = child;
      }

      for (let k = 0; k < members.length; k++) {
        const m = members[k];
        const side = k < half ? -1 : 1;
        this.vx[m] += side * ux * imp;
        this.vy[m] += side * uy * imp;
      }
      individualCount += 2;
    }
    this.individuals = individualCount;
  }

  stats() {
    // 个体数 = 当前连通分量数（只统计，不分裂）
    this.individuals = this._components().length;
    // 存活物种数 = 还有粒子的物种个数
    const alive = new Set();
    for (let i = 0; i < this.count; i++) alive.add(this.type[i]);
    return {
      count: this.count,
      individuals: this.individuals,
      speciesCount: alive.size,
      totalSpecies: this.species.length,
      foodTotal: this.foodTotal,
      steps: this.steps,
    };
  }
}
