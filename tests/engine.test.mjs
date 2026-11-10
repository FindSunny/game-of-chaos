/**
 * 引擎与图样的回归测试。
 *
 * 用 node 直接跑，不依赖浏览器：
 *   node tests/engine.test.mjs
 *
 * 断言的是生命游戏的已知行为（振荡周期、滑翔机位移、枪的周期），
 * 规则算错了这里一定挂。
 */
import assert from 'node:assert/strict';
import { Board } from '../js/core/board.js';
import { Engine } from '../js/core/engine.js';
import { parseRule, formatRule } from '../js/core/rules.js';
import { PATTERNS, rotatePattern } from '../js/ui/patterns.js';

let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** 取图上所有活细胞的坐标，用于比较形状 */
function coordsOf(board) {
  const out = [];
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (board.cells[y * board.width + x] !== 0) out.push(`${x},${y}`);
    }
  }
  return out.sort();
}

function place(board, cells, ox, oy) {
  for (const [x, y] of cells) board.set(ox + x, oy + y, 1);
}

function makeEngine(width, height, ruleText = 'B3/S23', wrap = false) {
  const board = new Board(width, height, wrap);
  const engine = new Engine(board, parseRule(ruleText));
  return { board, engine };
}

const pattern = (id) => PATTERNS.find((p) => p.id === id).cells;

console.log('\n规则解析');

test('解析标准写法', () => {
  const rule = parseRule('B3/S23');
  assert.deepEqual([...rule.birth], [0, 0, 0, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual([...rule.survive], [0, 0, 1, 1, 0, 0, 0, 0, 0]);
});

test('容错：小写、空格、省略前缀、空集合', () => {
  assert.equal(parseRule('b3/s23').text, 'B3/S23');
  assert.equal(parseRule(' B3 / S23 ').text, 'B3/S23');
  assert.equal(parseRule('3/23').text, 'B3/S23');
  assert.equal(parseRule('B2/S').text, 'B2/S');
  assert.equal(parseRule('B/S').text, 'B/S');
});

test('非法规则抛错', () => {
  assert.throws(() => parseRule('hello'));
  assert.throws(() => parseRule('B3/S9'));
  assert.throws(() => parseRule('B3'));
});

test('格式化与解析互逆', () => {
  for (const preset of ['B3/S23', 'B36/S23', 'B3678/S34678', 'B1357/S1357']) {
    assert.equal(formatRule(parseRule(preset)), preset);
  }
});

console.log('\n基本演化');

test('方块保持不变', () => {
  const { board, engine } = makeEngine(10, 10);
  place(board, pattern('block'), 3, 3);
  const before = coordsOf(board);
  engine.step();
  assert.deepEqual(coordsOf(board), before);
  assert.equal(engine.stats.population, 4);
  assert.equal(engine.stats.births, 0);
  assert.equal(engine.stats.deaths, 0);
});

test('闪烁器周期为 2', () => {
  const { board, engine } = makeEngine(10, 10);
  place(board, pattern('blinker'), 3, 5); // 横排三点
  const horizontal = coordsOf(board);

  engine.step();
  assert.deepEqual(coordsOf(board), ['4,4', '4,5', '4,6']);
  assert.equal(engine.stats.births, 2);
  assert.equal(engine.stats.deaths, 2);

  engine.step();
  assert.deepEqual(coordsOf(board), horizontal);
});

test('滑翔机四代后整体右移一格、下移一格', () => {
  const { board, engine } = makeEngine(20, 20);
  place(board, pattern('glider'), 5, 5);
  const start = coordsOf(board);

  for (let i = 0; i < 4; i++) engine.step();
  const moved = start.map((c) => {
    const [x, y] = c.split(',').map(Number);
    return `${x + 1},${y + 1}`;
  });

  assert.deepEqual(coordsOf(board), moved);
  assert.equal(engine.stats.population, 5);
});

test('孤立细胞与一对细胞都会死掉', () => {
  const single = makeEngine(5, 5);
  single.board.set(2, 2, 1);
  single.engine.step();
  assert.equal(single.engine.stats.population, 0);

  const pair = makeEngine(5, 5);
  pair.board.set(2, 2, 1);
  pair.board.set(3, 2, 1);
  pair.engine.step();
  assert.equal(pair.engine.stats.population, 0);
});

test('非环绕模式下边界外视为死亡', () => {
  const { board, engine } = makeEngine(5, 5, 'B3/S23', false);
  // 贴着左边界的方块：若无环绕，左边三格邻居都在界外
  place(board, pattern('block'), 0, 0);
  const before = coordsOf(board);
  engine.step();
  assert.deepEqual(coordsOf(board), before);
});

test('环绕模式下滑翔机横穿边界后回到原位', () => {
  const { board, engine } = makeEngine(8, 8, 'B3/S23', true);
  place(board, pattern('glider'), 5, 5);
  const start = coordsOf(board);

  // 每 4 代平移 (1,1)，8x8 环面上跑 32 代正好绕回起点
  for (let i = 0; i < 32; i++) engine.step();
  assert.equal(engine.stats.population, 5);
  assert.deepEqual(coordsOf(board), start);
});

console.log('\n图样与工具函数');

test('所有图样坐标都非负且去重', () => {
  for (const p of PATTERNS) {
    const seen = new Set();
    assert.ok(p.cells.length > 0, `${p.id} 没有细胞`);
    for (const [x, y] of p.cells) {
      assert.ok(x >= 0 && y >= 0, `${p.id} 存在负坐标`);
      const key = `${x},${y}`;
      assert.ok(!seen.has(key), `${p.id} 存在重复坐标 ${key}`);
      seen.add(key);
    }
  }
});

test('高斯帕滑翔机枪每 30 代放出一只滑翔机', () => {
  const { board, engine } = makeEngine(80, 60);
  place(board, pattern('gospergun'), 2, 2);
  assert.equal(board.countAlive(), 36);

  for (let i = 0; i < 30; i++) engine.step();
  // 枪本体回到原状，外加一只 5 格的滑翔机
  assert.equal(engine.stats.population, 41);
});

test('橡果会持续生长', () => {
  const { board, engine } = makeEngine(60, 60);
  place(board, pattern('acorn'), 28, 28);
  for (let i = 0; i < 20; i++) engine.step();
  assert.ok(engine.stats.population > 7, `20 代后应长大，实际 ${engine.stats.population}`);
});

test('旋转 90 度后仍是同一批格子，只是坐标变换', () => {
  const cells = pattern('toad');
  const rotated = rotatePattern(cells);
  assert.equal(rotated.length, cells.length);
  assert.ok(rotated.every(([x, y]) => x >= 0 && y >= 0));
  // 旋转四次回到原状
  let again = cells;
  for (let i = 0; i < 4; i++) again = rotatePattern(again);
  assert.deepEqual(
    again.map((c) => c.join(',')).sort(),
    cells.map((c) => c.join(',')).sort(),
  );
});

console.log('\n双缓冲与尺寸');

test('Board.resize 保留左上角内容', () => {
  const board = new Board(4, 4);
  board.set(0, 0, 1);
  board.set(3, 3, 1);
  board.resize(6, 6);
  assert.equal(board.get(0, 0), 1);
  // 3,3 在 4x4 内，仍在范围内
  assert.equal(board.get(3, 3), 1);
  assert.equal(board.width, 6);
  assert.equal(board.cells.length, 36);
});

test('一步演化后交换双缓冲，旧数组不再被改写', () => {
  const { board, engine } = makeEngine(10, 10);
  place(board, pattern('glider'), 2, 2);
  const before = board.cells;
  const beforeCopy = Array.from(before);

  engine.step();

  // 交换发生：当前代指针换成了另一个数组
  assert.notEqual(board.cells, before);
  // 旧数组内容保持不动，说明下一步不会回头污染上一代
  assert.deepEqual(Array.from(before), beforeCopy);
});

console.log(`\n全部通过：${passed} 项\n`);
