import assert from 'node:assert/strict';
import { ColonyEngine } from '../js/core/colony-engine.js';

function section(name) {
  console.log(`\n${name}`);
}
function test(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

section('初始化');

const e = new ColonyEngine(1200, 800, { seed: 1 });

test('初始种群非空，食物非空', () => {
  assert.ok(e.count > 0);
  assert.ok(e.count <= e.maxPop);
  assert.ok(e.foodTotal > 0);
});

test('类型都在合法范围内', () => {
  for (let i = 0; i < e.count; i++) {
    assert.ok(e.type[i] >= 0 && e.type[i] < e.nSpecies);
  }
});

section('黏性与分裂');

test('同色粒子互相吸引（会靠近）', () => {
  const g = new ColonyEngine(1200, 800, { seed: 2, seedCount: 2, foodMax: 0, foodRegen: 0, metabolism: 0, budThreshold: 1e9 });
  // 两个同色粒子，距离 20（在吸引半径内）
  g.x[0] = 600;
  g.y[0] = 400;
  g.x[1] = 620;
  g.y[1] = 400;
  g.vx[0] = g.vy[0] = g.vx[1] = g.vy[1] = 0;
  g.type[0] = g.type[1] = 0;
  const d0 = Math.hypot(g.x[1] - g.x[0], g.y[1] - g.y[0]);
  for (let i = 0; i < 40; i++) g.step();
  const d1 = Math.hypot(g.x[1] - g.x[0], g.y[1] - g.y[0]);
  assert.ok(d1 < d0, `同色应靠近：${d0.toFixed(1)} -> ${d1.toFixed(1)}`);
});

test('大团块会分裂成两个个体', () => {
  const g = new ColonyEngine(1200, 800, { seed: 3, seedCount: 0, maxSize: 8, bondR: 16, foodMax: 0, foodRegen: 0, metabolism: 0, budThreshold: 1e9, mortalityRate: 0 });
  // 手动放一堆同色粒子挤在一起，远大于 maxSize
  for (let i = 0; i < 30; i++) {
    g._push(0, 600 + (i % 6) * 3, 400 + Math.floor(i / 6) * 3, 100);
  }
  // 分裂前：30 个同色粒子连成一个连通分量
  assert.equal(g._components().length, 1, '分裂前应是一个团块');
  g._split();
  assert.equal(g.individuals, 2, `超过 maxSize 应一分为二，实际 ${g.individuals}`);
});

test('异色粒子不会黏成一个个体', () => {
  const g = new ColonyEngine(1200, 800, { seed: 4, seedCount: 0, maxSize: 100, bondR: 16, foodMax: 0, foodRegen: 0, metabolism: 0, budThreshold: 1e9, mortalityRate: 0 });
  g._push(0, 600, 400, 100);
  g._push(1, 605, 400, 100);
  g._split();
  assert.equal(g.individuals, 2, `异色应算两个个体，实际 ${g.individuals}`);
});

section('繁殖与稳定');

test('食物充足时种群增长并稳定，不灭绝', () => {
  const g = new ColonyEngine(1200, 800, { seed: 5, seedCount: 200 });
  for (let i = 0; i < 3000; i++) g.step();
  const s = g.stats();
  assert.ok(s.count > 500, `种群应增长到较大规模，实际 ${s.count}`);
  assert.ok(s.individuals > 0, '应有存活个体');
});

test('能量耗尽会死亡', () => {
  const g = new ColonyEngine(1200, 800, { seed: 6, seedCount: 100, foodMax: 0, foodRegen: 0, metabolism: 0.2, budThreshold: 1, mortalityRate: 0 });
  for (let i = 0; i < 100; i++) g.step();
  assert.equal(g.count, 0, `无食物高代谢应全灭，实际 ${g.count}`);
});

test('无 NaN，边界内', () => {
  const g = new ColonyEngine(1200, 800, { seed: 7, seedCount: 400 });
  for (let i = 0; i < 2000; i++) g.step();
  for (let i = 0; i < g.count; i++) {
    assert.ok(Number.isFinite(g.x[i]) && Number.isFinite(g.y[i]), `粒子 ${i} 坐标非法`);
    assert.ok(g.x[i] >= 0 && g.x[i] <= g.width);
    assert.ok(g.y[i] >= 0 && g.y[i] <= g.height);
  }
});

console.log('\n全部通过：8 项（黏性个体引擎）');
