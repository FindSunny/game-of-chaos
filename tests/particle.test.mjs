/**
 * 粒子生命测试。
 *
 * 规则是从 HackerPoet 的 Particle-Life 搬过来的，这里验证三件事：
 *   1. 力曲线方向对：范围内正吸引、负排斥，超距无作用，软核永远排斥
 *   2. 同种子可复现
 *   3. 边界处理（环绕 / 反弹）
 *
 *   node tests/particle.test.mjs
 */
import assert from 'node:assert/strict';
import { ParticleLifeEngine, PARTICLE_PRESETS } from '../js/core/particle-life.js';

let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** 造一个只有两个粒子的场景，类型 0 和 1，位置和矩阵全部手动指定 */
function pair(options = {}) {
  const engine = new ParticleLifeEngine(1000, 600, { preset: 'Balanced', count: 2, seed: 7, ...options });
  engine.nTypes = 2;
  engine.attract = new Float32Array(4);
  engine.minR = new Float32Array(4);
  engine.maxR = new Float32Array(4);

  // 0 ↔ 1 之间：minR 10、maxR 100；同类型排斥
  const set = (i, j, a, lo, hi) => {
    const k = i * 2 + j;
    engine.attract[k] = a;
    engine.minR[k] = lo;
    engine.maxR[k] = hi;
  };
  set(0, 0, -0.5, 10, 100);
  set(1, 1, -0.5, 10, 100);
  set(0, 1, 0.5, 10, 100);
  set(1, 0, 0.5, 10, 100);

  engine.x[0] = 100;
  engine.y[0] = 300;
  engine.x[1] = 150;
  engine.y[1] = 300;
  engine.vx[0] = 0;
  engine.vy[0] = 0;
  engine.vx[1] = 0;
  engine.vy[1] = 0;
  engine.type[0] = 0;
  engine.type[1] = 1;

  return engine;
}

console.log('\n力曲线');

test('正吸引：两颗粒子互相靠拢', () => {
  const engine = pair();
  engine.step();
  assert.ok(engine.x[0] > 100, `左边的应右移，实际 ${engine.x[0]}`);
  assert.ok(engine.x[1] < 150, `右边的应左移，实际 ${engine.x[1]}`);
});

test('负排斥：两颗粒子互相远离', () => {
  const engine = pair();
  for (const k of [1, 2]) engine.attract[k] = -0.5; // 0→1 和 1→0 都改成排斥
  engine.step();
  assert.ok(engine.x[0] < 100, `左边的应左移，实际 ${engine.x[0]}`);
  assert.ok(engine.x[1] > 150, `右边的应右移，实际 ${engine.x[1]}`);
});

test('超出 maxR 完全不作用', () => {
  const engine = pair();
  engine.x[1] = 400; // 距离 300 > maxR 100
  engine.step();
  assert.equal(engine.vx[0], 0);
  assert.equal(engine.vx[1], 0);
  assert.equal(engine.x[0], 100);
  assert.equal(engine.x[1], 400);
});

test('软核：距离小于 minR 时无条件排斥', () => {
  const engine = pair();
  engine.x[1] = 105; // 距离 5 < minR 10，即使 attract 是正的也排斥
  engine.step();
  assert.ok(engine.x[0] < 100, `软核应把左粒子推开，实际 ${engine.x[0]}`);
  assert.ok(engine.x[1] > 105, `软核应把右粒子推开，实际 ${engine.x[1]}`);
});

test('完全重合不会除零崩溃', () => {
  const engine = pair();
  engine.x[1] = 100;
  engine.y[1] = 300;
  engine.step();
  assert.ok(Number.isFinite(engine.x[0]) && Number.isFinite(engine.x[1]));
});

console.log('\n可复现与边界');

test('同种子逐粒子一致，不同种子不同', () => {
  const run = (seed) => {
    const e = new ParticleLifeEngine(800, 600, { preset: 'Gliders', count: 150, seed });
    for (let i = 0; i < 20; i++) e.step();
    return `${Array.from(e.x).map((v) => v.toFixed(3)).join(',')}|${e.steps}`;
  };
  assert.equal(run(42), run(42));
  assert.notEqual(run(42), run(43));
});

test('环绕模式下坐标留在世界内', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Balanced', count: 120, seed: 3, wrap: true });
  for (let i = 0; i < 60; i++) {
    e.step();
    for (let k = 0; k < e.count; k++) {
      assert.ok(e.x[k] >= 0 && e.x[k] < 400, `x 越界: ${e.x[k]}`);
      assert.ok(e.y[k] >= 0 && e.y[k] < 300, `y 越界: ${e.y[k]}`);
    }
  }
});

test('非环绕模式下被墙弹回，坐标不越界', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Chaos', count: 120, seed: 5, wrap: false });
  for (let i = 0; i < 60; i++) {
    e.step();
    for (let k = 0; k < e.count; k++) {
      assert.ok(e.x[k] >= 0 && e.x[k] <= 400, `x 越界: ${e.x[k]}`);
      assert.ok(e.y[k] >= 0 && e.y[k] <= 300, `y 越界: ${e.y[k]}`);
    }
  }
});

test('撒粒子会追加数量', () => {
  const e = new ParticleLifeEngine(600, 400, { preset: 'Balanced', count: 50, seed: 9 });
  const before = e.count;
  e.spawn(300, 200, 20);
  assert.equal(e.count, before + 20);
  assert.equal(e.stats.population, e.count);
});

console.log('\n预设');

test('所有预设的半径有序、对角线排斥', () => {
  for (const name of Object.keys(PARTICLE_PRESETS)) {
    const e = new ParticleLifeEngine(800, 600, { preset: name });
    const n = e.nTypes;
    for (let i = 0; i < n; i++) {
      assert.ok(e.attract[i * n + i] < 0, `${name} 对角线应排斥`);
      for (let j = 0; j < n; j++) {
        assert.ok(e.maxR[i * n + j] >= e.minR[i * n + j], `${name} maxR < minR`);
        assert.ok(Math.abs(e.minR[i * n + j] - e.minR[j * n + i]) < 1e-6, `${name} 半径不对称`);
      }
    }
    assert.equal(e.count, PARTICLE_PRESETS[name].particles);
  }
});

test('类型颜色数量与类型数一致', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Diversity' });
  assert.equal(e.colors.length, e.nTypes);
  assert.equal(e.nTypes, 12);
});

console.log('\n作用力矩阵编辑');

test('setAttract 会夹在 ±0.25 之内', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Balanced' });
  e.setAttract(0, 1, 5);
  assert.equal(e.getAttract(0, 1), 0.25);
  e.setAttract(0, 1, -5);
  assert.equal(e.getAttract(0, 1), -0.25);
  e.setAttract(0, 1, 0.03);
  // 存的是 Float32Array，0.03 会有一点点精度损失
  assert.ok(Math.abs(e.getAttract(0, 1) - 0.03) < 1e-6);
});

test('单格修改只动那一格，不影响对称的半径', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Balanced' });
  const beforeMin = e.minR[0 * e.nTypes + 1];
  const beforeOther = e.getAttract(1, 0);
  e.setAttract(0, 1, 0.08);
  assert.equal(e.minR[0 * e.nTypes + 1], beforeMin);
  assert.equal(e.getAttract(1, 0), beforeOther, '反向那一格是独立的');
});

test('重掷矩阵保留粒子位置，且对角线仍是排斥', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Gliders', count: 120 });
  const x0 = Array.from(e.x).slice(0, 5);
  const before = e.getAttract(0, e.nTypes > 1 ? 1 : 0);

  e.randomizeAttract();

  assert.deepEqual(Array.from(e.x).slice(0, 5), x0, '粒子不该动');
  for (let i = 0; i < e.nTypes; i++) {
    assert.ok(e.getAttract(i, i) < 0, '对角线应保持排斥');
  }
  assert.notEqual(e.getAttract(0, e.nTypes > 1 ? 1 : 0), before);
});

console.log(`\n全部通过：${passed} 项\n`);
