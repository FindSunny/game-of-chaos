/**
 * 粒子生命（Particle Life）。
 *
 * 这是离格（off-lattice）系统，不是元胞自动机：没有网格、没有「代」，
 * 每帧算的是粒子两两之间的力。规则取自 HackerPoet（CodeParade）的 Particle-Life，
 * 参数与力曲线与 fnky/particle-life 的 JS 版本保持一致。
 *
 * 三条规则：
 *   1. 类型矩阵：任意两种粒子 (i, j) 之间存 attract / minR / maxR。
 *      对角线（同类型）永远是排斥，半径对称、吸引力不对称。
 *   2. 力随距离走三角：minR 处 0，中点最强，maxR 处 0；r < minR 时用软核强制排斥。
 *   3. 速度累加后积分位置，再乘阻尼；边界可环绕或反弹。
 */

const RADIUS = 5.0;
const DIAMETER = RADIUS * 2;
const R_SMOOTH = 2.0;

/**
 * 速度上限（世界单位/步）。
 * 力是逐步累加的加速度，没有上限的话，密集团块里几个粒子被软核排斥同时推开，
 * 速度能冲到 17（正常约 1.5），表现为「团块突然炸开」。
 * 这里封顶，只削掉异常值，不改变正常动力学。
 */
const MAX_SPEED = 6;
const MAX_SPEED2 = MAX_SPEED * MAX_SPEED;

/** 与 fnky/particle-life 相同的预设，8 个参数依次是
 *  [attractMean, attractStd, minRLower, minRUpper, maxRLower, maxRUpper, friction, flatForce] */
export const PARTICLE_PRESETS = {
  Balanced: { label: '平衡', types: 9, particles: 400, params: [-0.02, 0.06, 0, 20, 20, 70, 0.05, false] },
  Chaos: { label: '混沌', types: 6, particles: 400, params: [0.02, 0.04, 0, 30, 30, 100, 0.01, false] },
  Diversity: { label: '多样', types: 12, particles: 400, params: [-0.01, 0.04, 0, 20, 10, 60, 0.05, true] },
  Gliders: { label: '滑翔机', types: 6, particles: 400, params: [0, 0.06, 0, 20, 10, 50, 0.1, true] },
  Quiescence: { label: '静止', types: 6, particles: 300, params: [-0.02, 0.1, 10, 20, 20, 60, 0.2, false] },
  'Small Clusters': { label: '小团簇', types: 6, particles: 600, params: [-0.005, 0.01, 10, 10, 20, 50, 0.01, false] },
};

/** 可复现随机数 */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 类型配色：直接采用 sandbox-science.com/particle-life 的十色方案
 * （Tailwind 500 色阶，红→橙→黄→绿→青→蓝→靛→紫→粉色），
 * 明度一致、相邻色相拉得开，深色背景上辨识度最好。
 * 类型数超过十个时，再接一组补充色，避免重复。
 */
const SITE_COLORS = [
  '#EF4444', // red
  '#F97316', // orange
  '#EAB308', // yellow
  '#22C55E', // green
  '#14B8A6', // teal
  '#06B6D4', // cyan
  '#3B82F6', // blue
  '#6366F1', // indigo
  '#A855F7', // purple
  '#EC4899', // pink
];

const EXTRA_COLORS = [
  '#84CC16', // lime
  '#0EA5E9', // sky
  '#8B5CF6', // violet
  '#D946EF', // fuchsia
  '#F43F5E', // rose
  '#F59E0B', // amber
];

function paletteColor(type, nTypes) {
  const n = Math.max(1, nTypes);
  const i = ((type % n) + n) % n;
  if (i < SITE_COLORS.length) return SITE_COLORS[i];
  return EXTRA_COLORS[(i - SITE_COLORS.length) % EXTRA_COLORS.length];
}

/**
 * 无限世界的网格键：把二维格子坐标压成一个整数。
 * 用字符串键（"x,y"）会慢一个数量级，这里按 32768 的偏移打包。
 */
function cellKey(cx, cy) {
  return (cx + 32768) * 65536 + (cy + 32768);
}
export class ParticleLifeEngine {
  /**
   * @param {number} width 世界宽（世界单位）
   * @param {number} height 世界高
   * @param {{preset?: string, count?: number, wrap?: boolean, seed?: number}} options
   */
  constructor(width, height, options = {}) {
    this.width = width;
    this.height = height;
    this.wrap = options.wrap ?? false;
    // 无限世界：没有墙、没有环绕，坐标可以为负，相机可以一直往外拖
    this.infinite = options.infinite ?? false;
    // 手动指定摩擦时优先用它；换预设会清掉，回到预设自带的值
    this.frictionOverride = options.friction ?? null;
    this.presetName = options.preset ?? 'Balanced';
    this.seedValue = options.seed ?? 20261110;
    this.countOverride = options.count ?? null;
    this.steps = 0;
    this.reset();
  }

  /** 按当前预设重建类型矩阵和粒子 */
  reset(presetName = this.presetName) {
    this.presetName = presetName;
    const preset = PARTICLE_PRESETS[presetName] || PARTICLE_PRESETS.Balanced;
    const [attractMean, attractStd, minRLower, minRUpper, maxRLower, maxRUpper, friction, flatForce] =
      preset.params;

    this.rng = mulberry32(this.seedValue);
    this.nTypes = preset.types;
    // 手调过摩擦就一直用手动值，直到换预设
    this.friction = this.frictionOverride ?? friction;
    this.presetFriction = friction;
    this.flatForce = flatForce;
    this.count = this.countOverride ?? preset.particles;

    const n = this.nTypes;
    this.attract = new Float32Array(n * n);
    this.minR = new Float32Array(n * n);
    this.maxR = new Float32Array(n * n);

    const normal = (mean, std) => {
      // Box-Muller
      const u = Math.max(this.rng(), 1e-9);
      const v = this.rng();
      return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const uniform = (a, b) => a + (b - a) * this.rng();

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const idx = i * n + j;
        if (i === j) {
          this.attract[idx] = -Math.abs(normal(attractMean, attractStd));
          this.minR[idx] = DIAMETER;
        } else {
          this.attract[idx] = normal(attractMean, attractStd);
          this.minR[idx] = Math.max(uniform(minRLower, minRUpper), DIAMETER);
        }
        this.maxR[idx] = Math.max(uniform(maxRLower, maxRUpper), this.minR[idx]);

        // 半径保持对称，吸引力不对称
        const mirror = j * n + i;
        this.maxR[mirror] = this.maxR[idx];
        this.minR[mirror] = this.minR[idx];
      }
    }

    this.x = new Float32Array(this.count);
    this.y = new Float32Array(this.count);
    this.vx = new Float32Array(this.count);
    this.vy = new Float32Array(this.count);
    this.type = new Uint8Array(this.count);

    // 网格边长取全局最大作用半径，保证邻近 9 格能覆盖所有可能产生力的粒子对
    let maxRadius = 0;
    for (let k = 0; k < this.maxR.length; k++) {
      if (this.maxR[k] > maxRadius) maxRadius = this.maxR[k];
    }
    this.cellSize = Math.max(8, maxRadius);

    for (let i = 0; i < this.count; i++) {
      this.type[i] = Math.floor(this.rng() * n);
      this.x[i] = (this.rng() * 0.5 + 0.25) * this.width;
      this.y[i] = (this.rng() * 0.5 + 0.25) * this.height;
      this.vx[i] = normal(0, 0.2);
      this.vy[i] = normal(0, 0.2);
    }

    this.steps = 0;
    this.stats = { population: this.count, types: this.nTypes, births: 0, deaths: 0 };
    this.colors = Array.from({ length: n }, (_, i) => paletteColor(i, n));
  }

  /**
   * 只重掷吸引力矩阵，粒子位置/类型不变。
   * 用途：调矩阵时保留当前这团粒子，立刻看到新规则的效果。
   */
  randomizeAttract() {
    const n = this.nTypes;
    const preset = PARTICLE_PRESETS[this.presetName] || PARTICLE_PRESETS.Balanced;
    const [attractMean, attractStd] = preset.params;
    const normal = (mean, std) => {
      const u = Math.max(this.rng(), 1e-9);
      const v = this.rng();
      return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const idx = i * n + j;
        this.attract[idx] =
          i === j ? -Math.abs(normal(attractMean, attractStd)) : normal(attractMean, attractStd);
      }
    }
  }

  /** 单格修改吸引力；夹在 ±0.25，避免手滑把粒子甩飞 */
  setAttract(i, j, value) {
    const n = this.nTypes;
    if (i < 0 || j < 0 || i >= n || j >= n) return;
    const clamped = Math.max(-0.25, Math.min(0.25, value));
    this.attract[i * n + j] = clamped;
    return clamped;
  }

  getAttract(i, j) {
    return this.attract[i * this.nTypes + j];
  }

  resetCounters() {
    this.steps = 0;
    this.stats = { population: this.count, types: this.nTypes, births: 0, deaths: 0 };
  }

  /** 把整团粒子平移到世界中心（切到无限世界时用，保证一上来就在视野里） */
  centerParticles() {
    const n = this.count;
    if (!n) return;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sx += this.x[i];
      sy += this.y[i];
    }
    const dx = this.width / 2 - sx / n;
    const dy = this.height / 2 - sy / n;
    for (let i = 0; i < n; i++) {
      this.x[i] += dx;
      this.y[i] += dy;
    }
  }

  get generation() {
    return this.steps;
  }

  /** 摩擦：每步速度衰减的比例。越大越快停下来，也越好静下来形成结构 */
  setFriction(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return this.friction;
    this.frictionOverride = Math.max(0.001, Math.min(0.4, v));
    this.friction = this.frictionOverride;
    return this.friction;
  }

  setOptions(options) {
    if (options.preset !== undefined) {
      // 换预设时丢掉手动摩擦，回到预设自带的值
      this.frictionOverride = null;
      this.reset(options.preset);
    }
    if (options.friction !== undefined) this.setFriction(options.friction);
    if (options.wrap !== undefined) this.wrap = options.wrap;
    if (options.infinite !== undefined && options.infinite !== this.infinite) {
      this.infinite = options.infinite;
      this.hashGrid = null;
      // 切到无限世界时把粒子挪到原点附近，否则可能落在很远的负坐标上
      if (this.infinite) this.centerParticles();
    }
    if (options.count !== undefined) {
      this.countOverride = options.count;
      this.reset();
    }
  }

  /** 在世界坐标 (wx, wy) 附近撒一把粒子 */
  spawn(wx, wy, amount = 24) {
    const n = this.nTypes;
    const start = this.count;
    const extra = amount;
    const grow = (arr, size, fill) => {
      const next = new (arr.constructor)(size);
      next.set(arr.subarray(0, Math.min(arr.length, size)));
      if (fill !== undefined && size > arr.length) next.fill(fill, arr.length);
      return next;
    };
    this.x = grow(this.x, start + extra);
    this.y = grow(this.y, start + extra);
    this.vx = grow(this.vx, start + extra, 0);
    this.vy = grow(this.vy, start + extra, 0);
    this.type = grow(this.type, start + extra, 0);

    for (let i = 0; i < extra; i++) {
      const k = start + i;
      this.type[k] = Math.floor(this.rng() * n);
      this.x[k] = wx + (this.rng() - 0.5) * 40;
      this.y[k] = wy + (this.rng() - 0.5) * 40;
      this.vx[k] = (this.rng() - 0.5) * 0.4;
      this.vy[k] = (this.rng() - 0.5) * 0.4;
    }
    this.count += extra;
    this.stats.population = this.count;
  }

  /**
   * 空间网格：把粒子按格子分桶，只跟邻近 9 个桶比。
   * 格子边长取全局最大作用半径，保证不会漏掉任何能产生力的粒子对。
   *
   * 无限世界没有行列上限，改用「格子坐标 → 桶」的哈希表，
   * 键是二维坐标压成的整数，避免字符串键的开销。
   */
  buildGrid() {
    const { x, y, count: n } = this;
    const cell = this.cellSize;

    if (this.infinite) {
      const map = this.hashGrid || (this.hashGrid = new Map());
      // 粒子飘远之后旧格子会一直留着空桶，超过阈值就整体重建
      if (map.size > 40000) map.clear();
      else for (const bucket of map.values()) bucket.length = 0;

      for (let i = 0; i < n; i++) {
        const key = cellKey(Math.floor(x[i] / cell), Math.floor(y[i] / cell));
        let bucket = map.get(key);
        if (!bucket) {
          bucket = [];
          map.set(key, bucket);
        }
        bucket.push(i);
      }
      return;
    }

    const cols = Math.max(1, Math.ceil(this.width / cell));
    const rows = Math.max(1, Math.ceil(this.height / cell));

    if (!this.buckets || this.buckets.length !== cols * rows) {
      this.buckets = Array.from({ length: cols * rows }, () => []);
    } else {
      for (const bucket of this.buckets) bucket.length = 0;
    }

    for (let i = 0; i < n; i++) {
      let cx = Math.floor(x[i] / cell);
      let cy = Math.floor(y[i] / cell);
      if (cx < 0) cx = 0;
      else if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0;
      else if (cy >= rows) cy = rows - 1;
      this.buckets[cy * cols + cx].push(i);
    }

    this.gridCols = cols;
    this.gridRows = rows;
  }

  /** 推进一帧 */
  step() {
    const { x, y, vx, vy, type, attract, minR, maxR, nTypes, count: n } = this;
    const width = this.width;
    const height = this.height;
    const wrap = this.wrap;
    const infinite = this.infinite;

    this.buildGrid();
    const cols = this.gridCols;
    const rows = this.gridRows;
    const buckets = this.buckets;
    const hash = this.infinite ? this.hashGrid : null;
    const reach = this.cellSize;

    for (let i = 0; i < n; i++) {
      const px = x[i];
      const py = y[i];
      const ti = type[i] * nTypes;
      let ax = 0;
      let ay = 0;

      // 只扫自己所在格子和周围 8 格
      let gx = Math.floor(px / reach);
      let gy = Math.floor(py / reach);
      if (!infinite) {
        if (gx < 0) gx = 0;
        else if (gx >= cols) gx = cols - 1;
        if (gy < 0) gy = 0;
        else if (gy >= rows) gy = rows - 1;
      }

      for (let oy = -1; oy <= 1; oy++) {
        let cy = gy + oy;
        if (!infinite) {
          if (wrap) cy = (cy + rows) % rows;
          else if (cy < 0 || cy >= rows) continue;
        }

        for (let ox = -1; ox <= 1; ox++) {
          let cx = gx + ox;
          if (!infinite) {
            if (wrap) cx = (cx + cols) % cols;
            else if (cx < 0 || cx >= cols) continue;
          }

          const bucket = infinite ? hash.get(cellKey(cx, cy)) : buckets[cy * cols + cx];
          if (!bucket) continue;
          for (let b = 0; b < bucket.length; b++) {
            const j = bucket[b];
            if (i === j) continue;
            let dx = x[j] - px;
            let dy = y[j] - py;

            if (wrap && !infinite) {
              if (dx > width * 0.5) dx -= width;
              else if (dx < -width * 0.5) dx += width;
              if (dy > height * 0.5) dy -= height;
              else if (dy < -height * 0.5) dy += height;
            }

            const r2 = dx * dx + dy * dy;
            const idx = ti + type[j];
            const lo = minR[idx];
            const hi = maxR[idx];
            if (r2 > hi * hi || r2 < 0.01) continue;

            const r = Math.sqrt(r2);
            dx /= r;
            dy /= r;

            let f;
            if (r > lo) {
              if (this.flatForce) {
                f = attract[idx];
              } else {
                const numer = 2 * Math.abs(r - 0.5 * (hi + lo));
                const denom = hi - lo;
                f = attract[idx] * (1 - numer / denom);
              }
            } else {
              f = R_SMOOTH * lo * (1 / (lo + R_SMOOTH) - 1 / (r + R_SMOOTH));
            }

            ax += f * dx;
            ay += f * dy;
          }
        }
      }

      vx[i] += ax;
      vy[i] += ay;
    }

    const damp = 1 - this.friction;
    for (let i = 0; i < n; i++) {
      let px = x[i] + vx[i];
      let py = y[i] + vy[i];
      vx[i] *= damp;
      vy[i] *= damp;

      // 速度封顶：团块被挤压时软核排斥会瞬间给出很大的加速度，
      // 不截断就会把粒子以十几倍于正常的速度甩出去，看着像突然爆炸。
      const speed2 = vx[i] * vx[i] + vy[i] * vy[i];
      if (speed2 > MAX_SPEED2) {
        const k = MAX_SPEED / Math.sqrt(speed2);
        vx[i] *= k;
        vy[i] *= k;
      }

      if (infinite) {
        // 无限世界：没有墙也没有环绕，粒子想去哪去哪
      } else if (wrap) {
        if (px < 0) px += width;
        else if (px >= width) px -= width;
        if (py < 0) py += height;
        else if (py >= height) py -= height;
      } else {
        if (px < DIAMETER) {
          vx[i] = -vx[i];
          px = DIAMETER;
        } else if (px >= width - DIAMETER) {
          vx[i] = -vx[i];
          px = width - DIAMETER;
        }
        if (py < DIAMETER) {
          vy[i] = -vy[i];
          py = DIAMETER;
        } else if (py >= height - DIAMETER) {
          vy[i] = -vy[i];
          py = height - DIAMETER;
        }
      }

      x[i] = px;
      y[i] = py;
    }

    this.steps++;
    this.stats.population = n;
    return this.stats;
  }
}

export { RADIUS as PARTICLE_RADIUS };
