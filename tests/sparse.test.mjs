/**
 * 稀疏世界与无限生命游戏测试。
 *
 * 重点：坐标打包在负数和大坐标下不能串、规则结果要和稠密引擎一致、
 * 活细胞数量统计要准。
 *
 *   node tests/sparse.test.mjs
 */
import assert from 'node:assert/strict';
import { SparseWorld, keyOf, xOf, yOf } from '../js/core/sparse-world.js';
import { SparseLifeEngine } from '../js/core/sparse-life.js';
import { Board } from '../js/core/board.js';
import { Engine } from '../js/core/engine.js';
import { parseRule } from '../js/core/rules.js';
import { PATTERNS } from '../js/ui/patterns.js';

let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function makeWorld(cells, ox = 0, oy = 0) {
  const world = new SparseWorld();
  for (const [x, y] of cells) world.set(ox + x, oy + y, 1);
  return world;
}

function coordsOf(world) {
  const out = [];
  world.forEachAlive((x, y) => out.push(`${x},${y}`));
  return out.sort();
}

const pattern = (id) => PATTERNS.find((p) => p.id === id).cells;

console.log('\n坐标打包');

test('负数与零附近往返一致', () => {
  for (const [x, y] of [
    [0, 0],
    [-1, -1],
    [1, -1],
    [-100000, 99999],
    [0, -5],
  ]) {
    const key = keyOf(x, y);
    assert.equal(xOf(key), x, `x 还原失败: ${x}`);
    assert.equal(yOf(key), y, `y 还原失败: ${y}`);
  }
});

test('相邻坐标不会撞键', () => {
  const seen = new Set();
  for (let x = -3; x <= 3; x++) {
    for (let y = -3; y <= 3; y++) {
      const key = keyOf(x, y);
      assert.ok(!seen.has(key), `键冲突: ${x},${y}`);
      seen.add(key);
    }
  }
  assert.equal(seen.size, 49);
});

test('超范围坐标被钳制而不是溢出', () => {
  const key = keyOf(2 ** 30, 0);
  const x = xOf(key);
  assert.ok(Number.isSafeInteger(key));
  assert.ok(Math.abs(x) <= 2 ** 20, 'x 应被钳制回允许范围');
});

console.log('\n稀疏世界');

test('set/get/has/clear 行为正确', () => {
  const world = new SparseWorld();
  assert.equal(world.get(3, 4), 0);
  world.set(3, 4, 1);
  assert.equal(world.get(3, 4), 1);
  assert.equal(world.has(3, 4), true);
  assert.equal(world.countAlive(), 1);
  world.set(3, 4, 0);
  assert.equal(world.has(3, 4), false);
  assert.equal(world.countAlive(), 0);

  world.set(-5, 7, 1);
  world.clear();
  assert.equal(world.countAlive(), 0);
});

test('randomize 在指定区域撒点', () => {
  const world = new SparseWorld();
  let s = 1;
  const rng = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  world.randomize(0.5, rng, 100, -50, 40, 30);
  assert.ok(world.countAlive() > 200, `活细胞太少: ${world.countAlive()}`);
  let minX = Infinity;
  let maxX = -Infinity;
  world.forEachAlive((x) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  });
  assert.ok(minX >= 80 && maxX <= 120, `撒点越界: ${minX}..${maxX}`);
});

console.log('\n生命游戏规则');

test('方块稳定', () => {
  const world = makeWorld(pattern('block'));
  const engine = new SparseLifeEngine(world, parseRule('B3/S23'));
  const before = coordsOf(world);
  engine.step();
  assert.deepEqual(coordsOf(world), before);
  assert.equal(engine.stats.population, 4);
  assert.equal(engine.stats.births, 0);
  assert.equal(engine.stats.deaths, 0);
});

test('闪烁器周期 2', () => {
  const world = makeWorld(pattern('blinker'), 10, 10);
  const engine = new SparseLifeEngine(world, parseRule('B3/S23'));
  const start = coordsOf(world);

  engine.step();
  // 横排三点变成竖排三点，中间那格不动
  assert.deepEqual(coordsOf(world), ['11,9', '11,10', '11,11'].sort());
  engine.step();
  assert.deepEqual(coordsOf(world), start);
});

test('滑翔机四代平移一格', () => {
  const world = makeWorld(pattern('glider'), -7, 5);
  const engine = new SparseLifeEngine(world, parseRule('B3/S23'));
  const start = coordsOf(world);

  for (let i = 0; i < 4; i++) engine.step();
  const moved = start.map((c) => {
    const [x, y] = c.split(',').map(Number);
    return `${x + 1},${y + 1}`;
  });
  assert.deepEqual(coordsOf(world), moved);
});

test('坐标落到很远的地方也算得对', () => {
  const far = 900000;
  const world = makeWorld(pattern('block'), far, -far);
  const engine = new SparseLifeEngine(world, parseRule('B3/S23'));
  engine.step();
  assert.equal(engine.stats.population, 4);
  for (const coord of coordsOf(world)) {
    const [x, y] = coord.split(',').map(Number);
    assert.ok(x >= far && x <= far + 1, `x 跑偏了: ${coord}`);
    assert.ok(y >= -far && y <= -far + 1, `y 跑偏了: ${coord}`);
  }
});

test('与稠密引擎结果一致', () => {
  // 同一份随机棋盘，放进稀疏世界和稠密网格各跑 10 代。
  // 稠密网格用 60x60 且撒点只占中间 20x20，保证 10 代内扩不到边界，
  // 否则边界处理会让两边不可避免地分叉。
  const board = new Board(60, 60, false);
  const cells = [];
  let s = 12345;
  const rng = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let y = 20; y < 40; y++) {
    for (let x = 20; x < 40; x++) {
      if (rng() < 0.35) {
        board.set(x, y, 1);
        cells.push([x, y]);
      }
    }
  }

  const dense = new Engine(board, parseRule('B3/S23'));
  const world = new SparseWorld();
  for (const [x, y] of cells) world.set(x, y, 1);
  const sparse = new SparseLifeEngine(world, parseRule('B3/S23'));

  for (let i = 0; i < 10; i++) {
    dense.step();
    sparse.step();
  }

  const denseCoords = [];
  for (let y = 0; y < 60; y++) {
    for (let x = 0; x < 60; x++) {
      if (board.get(x, y)) denseCoords.push(`${x},${y}`);
    }
  }
  assert.deepEqual(coordsOf(world), denseCoords.sort());
  assert.equal(sparse.stats.population, dense.stats.population);
});

test('活细胞灭绝后世界清空且不报错', () => {
  const world = makeWorld([[0, 0]]);
  const engine = new SparseLifeEngine(world, parseRule('B3/S23'));
  engine.step();
  assert.equal(world.countAlive(), 0);
  engine.step();
  assert.equal(engine.stats.population, 0);
});

console.log(`\n全部通过：${passed} 项\n`);
