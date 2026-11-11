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

/** 与 fnky/particle-life 相同的预设，8 个参数依次是
 *  [attractMean, attractStd, minRLower, minRUpper, maxRLower, maxRUpper, friction, flatForce] */
export const PARTICLE_PRESETS = {
  Balanced: { types: 9, particles: 400, params: [-0.02, 0.06, 0, 20, 20, 70, 0.05, false] },
  Chaos: { types: 6, particles: 400, params: [0.02, 0.04, 0, 30, 30, 100, 0.01, false] },
  Diversity: { types: 12, particles: 400, params: [-0.01, 0.04, 0, 20, 10, 60, 0.05, true] },
  Gliders: { types: 6, particles: 400, params: [0, 0.06, 0, 20, 10, 50, 0.1, true] },
  Quiescence: { types: 6, particles: 300, params: [-0.02, 0.1, 10, 20, 20, 60, 0.2, false] },
  'Small Clusters': { types: 6, particles: 600, params: [-0.005, 0.01, 10, 10, 20, 50, 0.01, false] },
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
 * 类型配色：取自 particle-life-app 的 Natural Rainbow 调色板（256 色首尾衔接）。
 * 比 HSV 均分好看，也不会出现「一亮一暗」交替的跳色。
 * 用法与 InterpolatingPalette 一致：index = 256 * type / nTypes，再相邻插值。
 */
const NATURAL_RAINBOW = 'e8002e eb0029 ed0024 f0001f f2001c f20017 f50012 f7000d fa000a fc0005 ff0000 ff0500 ff0a00 ff0f00 ff1200 ff1700 ff1c00 ff2100 ff2600 ff2b00 ff3000 ff3600 ff3b00 ff4000 ff4500 ff4a00 ff4f00 ff5400 ff5700 ff5c00 ff6100 ff6600 ff6900 ff6b00 ff6e00 ff7000 ff7300 ff7500 ff7800 ff7800 ff7d00 ff7d00 ff8200 ff8200 ff8700 ff8700 ff8a00 ff8c00 ff8f00 ff9100 ff9400 ff9600 ff9900 ff9c00 ff9e00 ffa100 ffa300 ffa600 ffa800 ffab00 ffab00 ffb000 ffb000 ffb500 ffb500 ffba00 ffba00 ffbd00 ffbf00 ffc200 ffc400 ffc700 ffc900 ffcc00 ffcf00 ffd100 ffd400 ffd600 ffd900 ffdb00 ffde00 ffde00 ffe300 ffe300 ffe800 ffe800 ffed00 ffed00 fff000 fff200 fff500 fff700 fffa00 fffc00 ffff00 fafc00 f5fa00 f0f700 ebf500 e6f200 e3f000 deed00 d9eb00 d4e800 cfe600 c9e300 c4e000 bfde00 badb00 b5d900 b0d600 abd600 a6d100 a3d100 9ecc00 99cc00 91c900 8ac700 82c400 7ac200 73bf00 6ebd00 66ba00 5eb800 57b500 4fb200 47b000 40ad00 3bab00 33ab00 2ba600 24a600 1ca300 17a100 0d9e00 089c00 009900 00990a 009912 00991c 009926 009930 00993b 009945 00994c 009957 009961 00996b 009973 00997d 009987 009991 00999c 0099a3 0099ad 0099b8 0099c2 0099cc 0096cc 0094cc 0091cc 008fcc 008ccc 008acc 0087cc 0087cc 0082cc 0082cc 007dcc 007dcc 0078cc 0078cc 0075cc 0073cc 0070cc 006ecc 006bcc 0069cc 0066cc 0061c9 005cc7 0059c4 0054c2 004fbf 004abd 0045ba 0040b8 003db5 0038b2 0033b0 002ead 0029ab 0026a8 0021a6 001ca3 0017a1 00129e 000d9c 000a99 000596 000094 050094 0a0094 0d0096 120096 170096 1c0096 210096 260096 290096 2e0096 330096 380096 3d0096 420099 450099 4a0099 4f0099 540099 590099 5e0099 610099 660099 6b0096 700094 750091 7a008f 80008c 85008c 8a0087 8f0087 940085 990082 9c0080 a1007d a6007a ab0078 b00075 b50073 ba0070 bf006e c2006b c70069 cc0066 cf0063 d1005e d40059 d60054 d90052 d9004c db0047 de0042 e00040 e3003b e30036 e80030'.split(' ').map((h) => [
  parseInt(h.slice(0, 2), 16),
  parseInt(h.slice(2, 4), 16),
  parseInt(h.slice(4, 6), 16),
]);

function paletteColor(type, nTypes) {
  const n = Math.max(1, nTypes);
  const exact = (NATURAL_RAINBOW.length * type) / n;
  const lo = Math.min(NATURAL_RAINBOW.length - 1, Math.floor(exact));
  const hi = Math.min(NATURAL_RAINBOW.length - 1, Math.ceil(exact));
  const f = exact - lo;
  const a = NATURAL_RAINBOW[lo];
  const b = NATURAL_RAINBOW[hi];
  const c = [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
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
    this.friction = friction;
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

  get generation() {
    return this.steps;
  }

  setOptions(options) {
    if (options.preset !== undefined) this.reset(options.preset);
    if (options.wrap !== undefined) this.wrap = options.wrap;
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

  /** 推进一帧 */
  step() {
    const { x, y, vx, vy, type, attract, minR, maxR, nTypes, count: n } = this;
    const width = this.width;
    const height = this.height;
    const wrap = this.wrap;

    for (let i = 0; i < n; i++) {
      const px = x[i];
      const py = y[i];
      const ti = type[i] * nTypes;
      let ax = 0;
      let ay = 0;

      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        let dx = x[j] - px;
        let dy = y[j] - py;

        if (wrap) {
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

      vx[i] += ax;
      vy[i] += ay;
    }

    const damp = 1 - this.friction;
    for (let i = 0; i < n; i++) {
      let px = x[i] + vx[i];
      let py = y[i] + vy[i];
      vx[i] *= damp;
      vy[i] *= damp;

      if (wrap) {
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
