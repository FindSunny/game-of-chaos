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
    assert.ok(e.type[i] >= 0 && e.type[i] < e.species.length);
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

console.log('\n第二步：形态遗传与变异');

test('变异开启时，分裂会产生新物种', () => {
  const g = new ColonyEngine(1200, 800, { seed: 10, seedCount: 0, maxSize: 8, bondR: 16, mutStd: 0.2, mutProb: 1.0, foodMax: 0, foodRegen: 0, metabolism: 0, budThreshold: 1e9, mortalityRate: 0 });
  for (let i = 0; i < 30; i++) g._push(0, 600 + (i % 6) * 3, 400 + Math.floor(i / 6) * 3, 100);
  const before = g.species.length;
  g._split();
  assert.equal(g.species.length, before + 1, `应新增一个物种，${before} -> ${g.species.length}`);
});

test('新物种基因组与亲代不同（发生了变异）', () => {
  const g = new ColonyEngine(1200, 800, { seed: 11, seedCount: 0, maxSize: 8, bondR: 16, mutStd: 0.3, mutProb: 1.0, foodMax: 0, foodRegen: 0, metabolism: 0.02, budThreshold: 1e9, mortalityRate: 0 });
  for (let i = 0; i < 30; i++) g._push(0, 600 + (i % 6) * 3, 400 + Math.floor(i / 6) * 3, 100);
  const parentAttract = g.species[0].attract;
  const parentMetab = g.species[0].metabolism;
  g._split();
  const child = g.species[g.species.length - 1]; // 最新变异出来的物种
  const changed = Math.abs(child.attract - parentAttract) > 1e-6 || Math.abs(child.metabolism - parentMetab) > 1e-6;
  assert.ok(changed, `新物种应偏离亲代：attract ${parentAttract}->${child.attract}, metabolism ${parentMetab}->${child.metabolism}`);
});

test('变异关闭时，分裂不产生新物种', () => {
  const g = new ColonyEngine(1200, 800, { seed: 12, seedCount: 0, species: 1, maxSize: 8, bondR: 16, mutStd: 0, mutProb: 1.0, foodMax: 0, foodRegen: 0, metabolism: 0, budThreshold: 1e9, mortalityRate: 0 });
  for (let i = 0; i < 30; i++) g._push(0, 600 + (i % 6) * 3, 400 + Math.floor(i / 6) * 3, 100);
  g._split();
  assert.equal(g.species.length, 1, 'mutStd=0 不应产生新物种');
});

test('长期运行：物种数不会超过 maxSpecies，统计自洽', () => {
  const g = new ColonyEngine(1200, 800, { seed: 13, seedCount: 200, maxSize: 30, mutStd: 0.25, mutProb: 0.6, maxSpecies: 16 });
  for (let i = 0; i < 4000; i++) g.step();
  const s = g.stats();
  assert.ok(s.totalSpecies <= 16, `物种总数应封顶，实际 ${s.totalSpecies}`);
  assert.ok(s.speciesCount <= s.totalSpecies);
  assert.ok(s.speciesCount > 0, '应有存活物种');
});

console.log('\n趋化（觅食迁移）');

test('趋化开启时，团块会往食物浓度高的方向迁移', () => {
  const g = new ColonyEngine(1200, 800, { seed: 1, seedCount: 0, species: 1, chemotaxis: 0.5, foodMax: 2, foodRegen: 0, metabolism: 0, budThreshold: 1e9, mortalityRate: 0, friction: 0.05 });
  // 静态食物梯度：左贫右富
  for (let c = 0; c < g.food.length; c++) {
    const cx = c % g.foodCols;
    g.food[c] = (cx / g.foodCols) * g.foodMax;
  }
  for (let i = 0; i < 8; i++) g._push(0, 80 + (i % 4) * 5, 400 + Math.floor(i / 4) * 5, 100);
  const centroid = () => {
    let s = 0;
    for (let i = 0; i < g.count; i++) s += g.x[i];
    return s / g.count;
  };
  const x0 = centroid();
  for (let i = 0; i < 300; i++) g.step();
  const x1 = centroid();
  assert.ok(x1 > x0 + 20, `团块应往右迁移，${x0.toFixed(0)} -> ${x1.toFixed(0)}`);
});

test('趋化关闭时，团块几乎不动', () => {
  const g = new ColonyEngine(1200, 800, { seed: 1, seedCount: 0, species: 1, chemotaxis: 0, foodMax: 2, foodRegen: 0, metabolism: 0, budThreshold: 1e9, mortalityRate: 0, friction: 0.05 });
  for (let i = 0; i < 8; i++) g._push(0, 80 + (i % 4) * 5, 400 + Math.floor(i / 4) * 5, 100);
  const centroid = () => {
    let s = 0;
    for (let i = 0; i < g.count; i++) s += g.x[i];
    return s / g.count;
  };
  const x0 = centroid();
  for (let i = 0; i < 300; i++) g.step();
  const x1 = centroid();
  assert.ok(Math.abs(x1 - x0) < 10, `无趋化应基本不动，${x0.toFixed(0)} -> ${x1.toFixed(0)}`);
});

console.log('\n全部通过：14 项（黏性个体引擎）');
