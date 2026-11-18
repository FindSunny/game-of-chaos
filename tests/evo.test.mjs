import assert from 'node:assert/strict';
import { EvoEngine } from '../js/core/evo-engine.js';

function section(name) {
  console.log(`\n${name}`);
}
function test(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

section('初始化');

const e = new EvoEngine(1200, 800, { seed: 1 });

test('初始种群和食物都非空', () => {
  assert.ok(e.count > 0);
  assert.ok(e.count <= e.maxPop);
  assert.ok(e.food.length === 60 * 40);
  assert.ok(e.foodTotal > 0);
});

test('基因组都在合法区间内', () => {
  for (let i = 0; i < e.count; i++) {
    assert.ok(e.genome[i] >= 0.05 && e.genome[i] <= 2.5);
  }
});

section('复制与选择');

test('能量充足时会发生复制，种群增长', () => {
  const g = new EvoEngine(1200, 800, { seed: 2, seedCount: 50, foodMax: 2, foodRegen: 0.5, repThreshold: 5, metabolismCoeff: 0.001 });
  // 初始食物铺满、再生很快、代谢很低 → 复制必然发生
  const before = g.count;
  for (let i = 0; i < 300; i++) g.step();
  assert.ok(g.count > before, `种群应增长：${before} -> ${g.count}`);
});

test('复制产生的子代基因组接近亲代（变异小）', () => {
  const g = new EvoEngine(1200, 800, { seed: 3, seedCount: 1, foodMax: 2, foodRegen: 1, repThreshold: 2, metabolismCoeff: 0, mutStd: 0.02, mortalityRate: 0 });
  const parent = g.genome[0];
  let sawChild = false;
  for (let i = 0; i < 2000 && !sawChild; i++) {
    const before = g.count;
    g.step();
    if (g.count > before) {
      const child = g.genome[g.count - 1];
      assert.ok(Math.abs(child - parent) < 0.15, `子代应接近亲代：${parent} vs ${child}`);
      sawChild = true;
    }
  }
  assert.ok(sawChild, '应该发生过复制');
});

test('食物被吃会减少，死亡会移除粒子', () => {
  const g = new EvoEngine(1200, 800, { seed: 4, seedCount: 200, foodMax: 1, foodRegen: 0, repThreshold: 5, metabolismCoeff: 0.2 });
  // 代谢极高、食物不再生 → 能量耗尽后大量死亡
  for (let i = 0; i < 100; i++) g.step();
  assert.ok(g.count < 200, `高代谢应导致死亡：实际 ${g.count}`);
  assert.ok(g.foodTotal < g.food.length, '食物应被吃掉一部分');
});

test('种群不会超过上限', () => {
  const g = new EvoEngine(1200, 800, { seed: 5, seedCount: 50, maxPop: 120, foodMax: 2, foodRegen: 0.5, repThreshold: 2, metabolismCoeff: 0.001 });
  for (let i = 0; i < 2000; i++) g.step();
  assert.ok(g.count <= 120, `种群应被上限截住：实际 ${g.count}`);
});

section('选择压：基因组向最优值收敛');

test('食物充足 + 随机死亡时，平均基因组向高效率端移动', () => {
  const g = new EvoEngine(1200, 800, { seed: 6, seedCount: 200, maxPop: 400, foodMax: 2, foodRegen: 0.5, repThreshold: 8, metabolismCoeff: 0.04, mutStd: 0.08, mortalityRate: 0.003 });
  const startMean = g.stats().meanGenome; // ~0.75
  for (let i = 0; i < 6000; i++) g.step();
  const s = g.stats();
  assert.ok(s.meanGenome > startMean + 0.1, `平均基因组应上升：${startMean.toFixed(2)} -> ${s.meanGenome.toFixed(2)}`);
});

test('食物匮乏时，选择压反过来偏向低代谢端', () => {
  const g = new EvoEngine(1200, 800, { seed: 6, seedCount: 400, maxPop: 2000, foodMax: 1.5, foodRegen: 0.05, repThreshold: 8, metabolismCoeff: 0.04, mutStd: 0.08 });
  const startMean = g.stats().meanGenome; // ~0.75
  for (let i = 0; i < 6000; i++) g.step();
  const s = g.stats();
  assert.ok(s.meanGenome < startMean, `资源稀缺应偏向低 g：${startMean.toFixed(2)} -> ${s.meanGenome.toFixed(2)}`);
});

test('统计接口自洽（均值在合法区间，σ 非负）', () => {
  const g = new EvoEngine(1200, 800, { seed: 7 });
  for (let i = 0; i < 50; i++) g.step();
  const s = g.stats();
  assert.ok(s.meanGenome >= 0.05 && s.meanGenome <= 2.5);
  assert.ok(s.sdGenome >= 0);
  assert.equal(s.count, g.count);
});

console.log('\n全部通过：8 项（演化引擎）');
