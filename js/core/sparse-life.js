/**
 * 无限生命游戏引擎：在稀疏世界上按 B/S 规则演化。
 *
 * 做法是经典的「候选集」法：
 *   1. 每个活细胞把自己的 3×3 邻域（含自己）计数 +1，得到一个候选集
 *   2. 候选格里：原本活的，计数 3 或 4（自己 + 2/3 个邻居）继续活；
 *      原本死的，计数 3 才出生
 *   3. 其余全部丢弃
 *
 * 只有活细胞周围才可能有变化，所以代价正比于活细胞数量，而不是平面面积。
 * 这样坐标可以无限延伸，没有任何边界。
 */
import { keyOf, xOf, yOf } from './sparse-world.js';

export class SparseLifeEngine {
  /**
   * @param {import('./sparse-world.js').SparseWorld} world
   * @param {{birth: Uint8Array, survive: Uint8Array}} rule
   */
  constructor(world, rule) {
    this.world = world;
    this.rule = rule;
    this.generation = 0;
    this.stats = { births: 0, deaths: 0, population: world.countAlive() };
  }

  setBoard(world) {
    this.world = world;
    this.generation = 0;
    this.stats = { births: 0, deaths: 0, population: world.countAlive() };
  }

  setRule(rule) {
    this.rule = rule;
  }

  resetCounters() {
    this.generation = 0;
    this.stats = { births: 0, deaths: 0, population: this.world.countAlive() };
  }

  step() {
    const alive = this.world.cells;
    const counts = new Map();

    // 活细胞给自己和八个邻居各投一票
    for (const key of alive.keys()) {
      const x = xOf(key);
      const y = yOf(key);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const k = keyOf(x + dx, y + dy);
          counts.set(k, (counts.get(k) || 0) + 1);
        }
      }
    }

    const next = new Map();
    let births = 0;
    let deaths = 0;

    for (const [key, count] of counts) {
      const wasAlive = alive.has(key);
      const lives = wasAlive ? count === 3 || count === 4 : count === 3;
      if (lives) {
        next.set(key, 1);
        if (!wasAlive) births++;
      } else if (wasAlive) {
        deaths++;
      }
    }

    this.world.cells = next;
    this.generation++;

    this.stats = { births, deaths, population: next.size };
    return this.stats;
  }
}
