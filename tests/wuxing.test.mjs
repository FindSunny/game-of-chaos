/**
 * 五行生克引擎测试。
 *
 * 规则是三条「计数阈值」判断，所以测试也按三条规则分别构造孤立局面：
 * 中心格 + 指定的几个邻居，断言中心格下一代会变成什么。
 *
 *   node tests/wuxing.test.mjs
 */
import assert from 'node:assert/strict';
import { Board } from '../js/core/board.js';
import {
  WuxingEngine,
  succ,
  pred,
  ke,
  keOf,
  seedWorld,
  scatterStates,
  WUXING_STATES,
} from '../js/core/wuxing.js';

let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 造一个 7x7 棋盘，中心格固定，其余留空 */
function scene(center, neighbors) {
  const board = new Board(7, 7, false);
  board.set(3, 3, center);
  for (const [x, y, state] of neighbors) board.set(3 + x, 3 + y, state);
  const engine = new WuxingEngine(board, { grow: 3, kill: 3 });
  return { board, engine };
}

const center = (board) => board.get(3, 3);

console.log('\n生克关系');

test('相生循环：木→火→土→金→水→木', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(succ), [2, 3, 4, 5, 1]);
  assert.deepEqual([1, 2, 3, 4, 5].map(pred), [5, 1, 2, 3, 4]);
});

test('相克循环：木克土、土克水、水克火、火克金、金克木', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(ke), [3, 4, 5, 1, 2]);
  assert.equal(ke(1), 3, '木克土');
  assert.equal(ke(3), 5, '土克水');
  assert.equal(ke(5), 2, '水克火');
  assert.equal(ke(2), 4, '火克金');
  assert.equal(ke(4), 1, '金克木');
});

test('生我者与克我者互为逆运算', () => {
  for (let s = 1; s <= 5; s++) {
    assert.equal(succ(pred(s)), s);
    assert.equal(pred(succ(s)), s);
    assert.equal(keOf(ke(s)), s);
    assert.equal(ke(keOf(s)), s);
  }
});

test('五行元数据齐全', () => {
  assert.equal(WUXING_STATES.length, 6);
  assert.deepEqual(
    WUXING_STATES.map((s) => s.name),
    ['空', '木', '火', '土', '金', '水'],
  );
  assert.ok(WUXING_STATES.slice(1).every((s) => /^#[0-9a-f]{6}$/i.test(s.color)));
});

console.log('\n三条规则');

test('生长：空格边长出邻居最多的元素「所生」', () => {
  const { board, engine } = scene(0, [
    [-1, -1, 1],
    [0, -1, 1],
    [1, -1, 1],
  ]);
  engine.step();
  assert.equal(center(board), 2, '木多，空格长出火');
});

test('被克星压住的元素不生长，由下一个满足条件的元素胜出', () => {
  // 三个木被三个土压住（土是木的克星），木出局；
  // 土自己没有被水压住，于是空格长出「土所生」的金
  const { board, engine } = scene(0, [
    [-1, -1, 1],
    [0, -1, 1],
    [1, -1, 1],
    [-1, 1, 3],
    [0, 1, 3],
    [1, 1, 3],
  ]);
  engine.step();
  assert.equal(center(board), 4, '土胜出，长出金');
});

test('克制：克我者达到阈值且多于生我者时死亡', () => {
  const { board, engine } = scene(1, [
    [-1, -1, 4],
    [0, -1, 4],
    [1, -1, 4],
  ]);
  engine.step();
  assert.equal(center(board), 0, '三金克木，木死');
});

test('转化：生我者达到阈值且多于克我者时推进', () => {
  const { board, engine } = scene(1, [
    [-1, -1, 5],
    [0, -1, 5],
    [1, -1, 5],
  ]);
  engine.step();
  assert.equal(center(board), 2, '三水生木，木进为火');
});

test('生克数量持平时保持原状', () => {
  const { board, engine } = scene(1, [
    [-1, -1, 5],
    [0, -1, 5],
    [1, -1, 5],
    [-1, 1, 4],
    [0, 1, 4],
    [1, 1, 4],
  ]);
  engine.step();
  assert.equal(center(board), 1, '生我 3、克我 3，谁也没压倒谁');
});

test('阈值可调：提高到 4 后三条都不触发', () => {
  const { board, engine } = scene(0, [
    [-1, -1, 1],
    [0, -1, 1],
    [1, -1, 1],
  ]);
  engine.setOptions({ grow: 4 });
  engine.step();
  assert.equal(center(board), 0, '只有 3 个木，未达阈值 4');
});

console.log('\n边界与统计');

test('非环绕时界外算空，环绕时能借到对面的邻居', () => {
  // 左边一列放 3 个木，中心格在 (0,3) 左侧没有邻居
  const flat = new Board(6, 6, false);
  flat.set(0, 3, 0);
  flat.set(5, 2, 1);
  flat.set(5, 3, 1);
  flat.set(5, 4, 1);
  const e1 = new WuxingEngine(flat, { grow: 3, kill: 3 });
  e1.step();
  assert.equal(flat.get(0, 3), 0, '不环绕时拿不到右边的邻居');

  const torus = new Board(6, 6, true);
  torus.set(0, 3, 0);
  torus.set(5, 2, 1);
  torus.set(5, 3, 1);
  torus.set(5, 4, 1);
  const e2 = new WuxingEngine(torus, { grow: 3, kill: 3 });
  e2.step();
  assert.equal(torus.get(0, 3), 2, '环绕时这 3 个木就在邻域里，长出火');
});

test('统计数字自洽：population 等于实际非空格数', () => {
  const board = new Board(20, 20, true);
  seedWorld(board, 0.3, mulberry32(7));
  const engine = new WuxingEngine(board, { grow: 3, kill: 3 });
  for (let i = 0; i < 10; i++) {
    const stats = engine.step();
    assert.equal(stats.population, board.countAlive());
    assert.equal(stats.births + stats.deaths + stats.transitions >= 0, true);
  }
});

test('同种子下演化完全可复现', () => {
  const run = () => {
    const board = new Board(24, 24, true);
    seedWorld(board, 0.3, mulberry32(99));
    const engine = new WuxingEngine(board, { grow: 3, kill: 3 });
    for (let i = 0; i < 30; i++) engine.step();
    return Array.from(board.cells).join(',') + '|' + engine.generation;
  };
  assert.equal(run(), run());
});

test('改变尺寸后引擎缓冲同步重建', () => {
  const board = new Board(10, 10, true);
  const engine = new WuxingEngine(board, { grow: 3, kill: 3 });
  board.resize(20, 15);
  engine.setBoard(board);
  assert.equal(engine.age.length, 300);
  engine.step();
  assert.equal(engine.stats.population, board.countAlive());
});

console.log('\n初始化与长期行为');

test('seedWorld 覆盖大致符合密度，且只写入合法状态', () => {
  for (const density of [0.2, 0.4]) {
    const board = new Board(80, 60, true);
    seedWorld(board, density, mulberry32(5));
    const alive = board.countAlive();
    const ratio = alive / board.cells.length;
    assert.ok(
      ratio > density * 0.3 && ratio < density * 1.6,
      `密度 ${density} 实际覆盖 ${ratio.toFixed(2)}`,
    );
    for (const v of board.cells) assert.ok(v >= 0 && v <= 5);
  }
});

test('scatterStates 会把棋盘撒成多态', () => {
  const board = new Board(40, 40, true);
  scatterStates(board, 0.5, mulberry32(3));
  const present = new Set(board.cells);
  assert.ok(present.size >= 5, `至少应有 5 种状态，实际 ${present.size}`);
});

test('默认参数下 300 代不灭绝、五态共存', () => {
  const board = new Board(160, 100, true);
  seedWorld(board, 0.3, mulberry32(2024));
  const engine = new WuxingEngine(board, { grow: 3, kill: 3 });

  for (let i = 0; i < 300; i++) engine.step();

  const ratio = engine.stats.population / board.cells.length;
  assert.ok(ratio > 0.05, `不应灭绝，实际存活率 ${ratio.toFixed(3)}`);
  assert.ok(ratio < 0.95, `不应铺满，实际存活率 ${ratio.toFixed(3)}`);

  const present = new Set();
  for (const v of board.cells) if (v !== 0) present.add(v);
  assert.equal(present.size, 5, `五态应共存，实际 ${present.size} 种`);
});

test('结构不会碎成噪点：存在成片的同态区域', () => {
  const board = new Board(96, 64, true);
  seedWorld(board, 0.3, mulberry32(11));
  const engine = new WuxingEngine(board, { grow: 3, kill: 3 });
  for (let i = 0; i < 120; i++) engine.step();

  // 洪水填充统计同态连通块，取最大块
  const seen = new Uint8Array(board.cells.length);
  let biggest = 0;
  const stack = [];
  for (let i = 0; i < board.cells.length; i++) {
    if (seen[i] || board.cells[i] === 0) continue;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    let size = 0;
    while (stack.length) {
      const cur = stack.pop();
      size++;
      const x = cur % board.width;
      const y = (cur - x) / board.width;
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        const wx = (nx + board.width) % board.width;
        const wy = (ny + board.height) % board.height;
        const ni = wy * board.width + wx;
        if (seen[ni] || board.cells[ni] !== board.cells[cur]) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    if (size > biggest) biggest = size;
  }

  assert.ok(biggest >= 30, `应存在至少 30 格的同态区域，实际最大 ${biggest}`);
});

console.log(`\n全部通过：${passed} 项\n`);
