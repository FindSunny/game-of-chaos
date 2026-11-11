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

console.log('\n无限画布');

test('无限世界不反弹：越过原点继续走', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Gliders', count: 1, infinite: true, seed: 7 });
  e.x[0] = 20;
  e.y[0] = 150;
  e.vx[0] = -5;
  e.vy[0] = 0;
  e.step();
  assert.ok(e.x[0] < 20, `应继续往左，实际 x = ${e.x[0]}`);
});

test('有限世界会反弹：同一初始条件撞墙回头', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Gliders', count: 1, infinite: false, seed: 7 });
  e.x[0] = 6;
  e.y[0] = 150;
  e.vx[0] = -5;
  e.vy[0] = 0;
  e.step();
  assert.ok(e.x[0] >= 10, `应被墙弹回，实际 x = ${e.x[0]}`);
});

test('无限世界：负坐标的邻居照样能互相作用', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Balanced', count: 2, infinite: true, seed: 3 });
  e.x[0] = -200;
  e.y[0] = -200;
  e.x[1] = -190;
  e.y[1] = -200;
  e.vx[0] = 0;
  e.vy[0] = 0;
  e.vx[1] = 0;
  e.vy[1] = 0;
  e.type[0] = 0;
  e.type[1] = 1;

  // 让这一对互相吸引，且作用半径为 100 > 间距 10
  const idx = 0 * e.nTypes + 1;
  const mirror = 1 * e.nTypes + 0;
  e.minR[idx] = e.minR[mirror] = 5;
  e.maxR[idx] = e.maxR[mirror] = 100;
  e.setAttract(0, 1, 0.2);
  e.setAttract(1, 0, 0.2);

  e.step();
  assert.ok(e.vx[0] > 0, `粒子 0 应被吸向右，实际 ${e.vx[0]}`);
  assert.ok(e.vx[1] < 0, `粒子 1 应被吸向左，实际 ${e.vx[1]}`);
});

test('切到无限世界会把粒子团挪回视野中心', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Gliders', count: 50 });
  for (let i = 0; i < e.count; i++) e.x[i] -= 5000;
  e.setOptions({ infinite: true });

  let sum = 0;
  for (let i = 0; i < e.count; i++) sum += e.x[i];
  assert.ok(Math.abs(sum / e.count - 200) < 1, `质心应回到 200，实际 ${sum / e.count}`);
  assert.equal(e.infinite, true);
});

console.log('\n摩擦');

test('预设自带摩擦：Gliders 是 0.1，Chaos 是 0.01', () => {
  assert.equal(new ParticleLifeEngine(400, 300, { preset: 'Gliders' }).friction, 0.1);
  assert.equal(new ParticleLifeEngine(400, 300, { preset: 'Chaos' }).friction, 0.01);
});

test('手调摩擦会被夹在 0.001 - 0.4', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Gliders' });
  e.setOptions({ friction: 9 });
  assert.equal(e.friction, 0.4);
  e.setOptions({ friction: -3 });
  assert.equal(e.friction, 0.001);
});

test('改数量不会丢掉手调摩擦，换预设才回到预设值', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Gliders' });
  e.setOptions({ friction: 0.02 });
  e.setOptions({ count: 500 });
  assert.equal(e.friction, 0.02, '改数量不该重置摩擦');
  e.setOptions({ preset: 'Chaos' });
  assert.equal(e.friction, 0.01, '换预设应回到预设自带的值');
});

test('摩擦越小，同样步数后平均速度越大', () => {
  const speeds = [0.2, 0.01].map((friction) => {
    const e = new ParticleLifeEngine(1200, 800, { preset: 'Gliders', count: 800, seed: 42 });
    e.setOptions({ friction });
    for (let i = 0; i < 120; i++) e.step();
    let sum = 0;
    for (let i = 0; i < e.count; i++) sum += Math.hypot(e.vx[i], e.vy[i]);
    return sum / e.count;
  });
  assert.ok(speeds[1] > speeds[0], `摩擦小的应该更快：${speeds[1].toFixed(2)} vs ${speeds[0].toFixed(2)}`);
});

console.log('\n作用半径 / 引力倍率');

test('作用半径倍率整体放大 maxR 和网格边长', () => {
  const e = new ParticleLifeEngine(1200, 800, { preset: 'Gliders', count: 200 });
  const before = Math.max(...e.maxR);
  const cellBefore = e.cellSize;
  e.setOptions({ radiusScale: 2 });
  assert.ok(Math.abs(Math.max(...e.maxR) - before * 2) < 1e-3);
  assert.ok(Math.abs(e.cellSize - cellBefore * 2) < 1e-3, '网格边长要跟着放大，否则会漏邻居');
});

test('反复设同一个倍率不会累积放大', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Gliders', count: 100 });
  const before = Math.max(...e.maxR);
  for (let i = 0; i < 5; i++) e.setOptions({ radiusScale: 1.5 });
  assert.ok(Math.abs(Math.max(...e.maxR) - before * 1.5) < 1e-3);
});

test('引力倍率缩放 attract，且不改变半径', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Gliders', count: 100 });
  const att = e.getAttract(0, 1);
  const maxR = Math.max(...e.maxR);
  e.setOptions({ forceScale: 1.5 });
  assert.ok(Math.abs(e.getAttract(0, 1) - att * 1.5) < 1e-6);
  assert.ok(Math.abs(Math.max(...e.maxR) - maxR) < 1e-6);
});

test('手改单格后再调引力倍率，不会把那格重复放大', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Gliders', count: 100 });
  e.setAttract(0, 1, 0.08);
  e.setOptions({ forceScale: 2 });
  assert.ok(Math.abs(e.getAttract(0, 1) - 0.16) < 1e-6, `应随倍率一起变 0.16，实际 ${e.getAttract(0, 1)}`);
  e.setOptions({ forceScale: 1 });
  assert.ok(Math.abs(e.getAttract(0, 1) - 0.08) < 1e-6, '回到 1 倍应还原为手改值');
});

console.log('\n线性软核 / dt 归一化');

/** 造一对几乎重合的粒子，落在 minR 之内 */
function overlappingPair(repel) {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Gliders', count: 2, repel });
  e.x[0] = 100;
  e.y[0] = 100;
  e.x[1] = 101;
  e.y[1] = 100;
  e.vx[0] = 0;
  e.vy[0] = 0;
  e.vx[1] = 0;
  e.vy[1] = 0;
  e.type[0] = 0;
  e.type[1] = 1;
  const idx = 0 * e.nTypes + 1;
  const mirror = 1 * e.nTypes + 0;
  e.minR[idx] = e.minR[mirror] = 20;
  e.maxR[idx] = e.maxR[mirror] = 50;
  return e;
}

test('排斥强度为 0 时，minR 内的粒子之间没有任何力', () => {
  const e = overlappingPair(0);
  e.step();
  assert.equal(e.vx[0], 0);
  assert.equal(e.vx[1], 0);
});

test('排斥强度越大，同距离下推得越快', () => {
  const weak = overlappingPair(0.5);
  const strong = overlappingPair(2);
  weak.step();
  strong.step();
  assert.ok(Math.abs(strong.vx[0]) > Math.abs(weak.vx[0]) * 3, '2.0 应明显推得更狠');
  assert.ok(weak.vx[0] < 0 && strong.vx[0] < 0, '0 号粒子应被推向负方向');
});

test('dt 归一化：两个半步 ≈ 一个整步', () => {
  const single = new ParticleLifeEngine(1200, 800, { preset: 'Gliders', count: 300, seed: 5 });
  const double = new ParticleLifeEngine(1200, 800, { preset: 'Gliders', count: 300, seed: 5 });

  single.step(1 / 60);
  double.step(1 / 120);
  double.step(1 / 120);

  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < single.count; i++) {
    s1 += Math.hypot(single.vx[i], single.vy[i]);
    s2 += Math.hypot(double.vx[i], double.vy[i]);
  }
  const a = s1 / single.count;
  const b = s2 / double.count;
  assert.ok(Math.abs(a - b) / Math.max(a, 1e-6) < 0.05, `平均速度应接近：${a.toFixed(4)} vs ${b.toFixed(4)}`);
});

test('速度上限默认关闭：极端挤压下会超过 6', () => {
  const e = new ParticleLifeEngine(400, 300, { preset: 'Gliders', count: 40, repel: 3 });
  for (let i = 0; i < e.count; i++) {
    e.x[i] = 200 + (i % 8) * 0.5;
    e.y[i] = 150 + Math.floor(i / 8) * 0.5;
    e.vx[i] = 0;
    e.vy[i] = 0;
    e.type[i] = i % 3;
  }
  for (let i = 0; i < e.nTypes; i++) {
    for (let j = 0; j < e.nTypes; j++) {
      const k = i * e.nTypes + j;
      e.minR[k] = 20;
      e.maxR[k] = 40;
    }
  }
  e.step();
  let max = 0;
  for (let i = 0; i < e.count; i++) max = Math.max(max, Math.hypot(e.vx[i], e.vy[i]));
  assert.ok(max > 6, `应不封顶，实际最大速度 ${max.toFixed(2)}`);
});

console.log(`\n全部通过：${passed} 项\n`);
