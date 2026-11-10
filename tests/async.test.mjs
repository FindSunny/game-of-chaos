/**
 * 异步因果引擎测试。
 *
 * 重点验证三件事：
 *   1. 光锥读取语义（严格的只看「已经送到」的状态）
 *   2. 传播延迟确实是 1/c 秒每格
 *   3. 同种子完全可复现（异步调度最怕结果不稳定）
 *
 *   node tests/async.test.mjs
 */
import assert from 'node:assert/strict';
import { Board } from '../js/core/board.js';
import { parseRule } from '../js/core/rules.js';
import { AsyncLifeEngine } from '../js/core/async-engine.js';

let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function makeEngine(options = {}) {
  const board = new Board(9, 9, false);
  const engine = new AsyncLifeEngine(board, parseRule('B3/S23'), { seed: 1, ...options });
  return { board, engine };
}

const center = (board) => board.index(4, 4);

function snapshot(board, engine) {
  return `${Array.from(board.cells).join('')}|${engine.updates}|${engine.simTime.toFixed(4)}`;
}

console.log('\n光锥读取');

test('邻居刚更新过时，只能读到它的上一版', () => {
  const { board, engine } = makeEngine({ c: 1 });
  const i = center(board);
  board.cells[i] = 1;
  engine.prev[i] = 0;
  engine.stamp[i] = 10;
  engine.prevStamp[i] = 9;

  // now = 10.5：cutoff = 10.5 - 1 = 9.5，邻居戳 10 太新，退回上一版（0）
  assert.equal(engine.readState(i, 10.5, 1), 0);
  // now = 11.5：cutoff = 10.5，邻居戳 10 已经「送到」，读当前值（1）
  assert.equal(engine.readState(i, 11.5, 1), 1);
});

test('关掉严格光锥后，直接读最新状态', () => {
  const { board, engine } = makeEngine({ c: 1, strictCone: false });
  const i = center(board);
  board.cells[i] = 1;
  engine.prev[i] = 0;
  engine.stamp[i] = 10;

  assert.equal(engine.readState(i, 10.5, 1), 1);
});

test('光速越小，需要的等待越久', () => {
  const { board, engine } = makeEngine({ c: 0.5 });
  const i = center(board);
  board.cells[i] = 1;
  engine.prev[i] = 0;
  engine.stamp[i] = 10;

  // c = 0.5 → 一格要 2 秒
  assert.equal(engine.readState(i, 11.5, 1), 0, '11.5 时还差一点');
  assert.equal(engine.readState(i, 12.5, 1), 1, '12.5 时已经送到');
});

test('countNeighbors 也遵守光锥', () => {
  const { board, engine } = makeEngine({ c: 1 });
  const c0 = center(board);
  board.clear();
  const nbr = board.index(4, 3);
  board.cells[nbr] = 1;
  engine.prev[nbr] = 0;
  engine.stamp[nbr] = 10;

  assert.equal(engine.countNeighbors(c0, 10.2), 0, '邻居太新，读到的是上一版空的');
  assert.equal(engine.countNeighbors(c0, 12), 1, '两秒后能读到');
});

console.log('\n调度');

test('触发模式：一个变化只通知 8 个邻居，并且在 t + 1/c 到达', () => {
  const { board, engine } = makeEngine({ mode: 'trigger', c: 2 });
  board.clear();
  engine.due.fill(Infinity);
  engine.heap.clear();
  engine.prev.fill(0);
  engine.stamp.fill(0);

  const i = center(board);
  board.cells[i] = 1; // 孤立细胞，下一代必死 → 会产生一次变化
  engine.process(i, 5);

  const expected = 5 + 1 / 2; // c = 2 格/秒
  let touched = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const j = board.index(4 + dx, 4 + dy);
      assert.equal(engine.due[j], expected, `邻居 ${dx},${dy} 应在 ${expected} 被唤醒`);
      touched++;
    }
  }
  assert.equal(touched, 8);
});

test('触发模式不会直接通知两格以外的格子', () => {
  const { board, engine } = makeEngine({ mode: 'trigger', c: 1 });
  board.clear();
  engine.due.fill(Infinity);
  engine.heap.clear();

  const i = center(board);
  board.cells[i] = 1;
  engine.process(i, 1);

  const far = board.index(4, 1); // 距离 3
  assert.equal(engine.due[far], Infinity);
});

test('周期模式的下一拍落在抖动区间内', () => {
  const { engine } = makeEngine({ rate: 4, jitter: 0.5 });
  const base = 1 / 4;
  for (let k = 0; k < 200; k++) {
    const interval = engine.nextInterval();
    assert.ok(interval >= base * 0.5 && interval <= base * 1.5, `第 ${k} 次抖动越界: ${interval}`);
  }
});

test('事件按时间顺序处理，仿真时间只前进', () => {
  const { board, engine } = makeEngine({ rate: 2 });
  board.randomize(0.3);
  const times = [];
  for (let k = 0; k < 20; k++) {
    engine.advance(0.5);
    times.push(engine.simTime);
  }
  for (let k = 1; k < times.length; k++) {
    assert.ok(times[k] > times[k - 1], '仿真时间倒退');
  }
  assert.ok(Math.abs(times[times.length - 1] - 10) < 1e-6);
});

test('队列不会无限增长', () => {
  const { board, engine } = makeEngine({ rate: 3 });
  board.randomize(0.35);
  const n = board.cells.length;
  for (let k = 0; k < 120; k++) engine.advance(0.2);
  assert.ok(engine.heap.size < n * 3, `队列膨胀到 ${engine.heap.size}`);
});

test('周期模式持续排期，不会处理完首批事件就停摆', () => {
  const { board, engine } = makeEngine({ rate: 2 });
  board.randomize(0.3);
  engine.reset();

  engine.advance(1);
  const first = engine.updates;
  assert.ok(first > 0, '第一秒应该有事件');

  engine.advance(1);
  assert.ok(engine.updates > first, `第二秒还应继续处理事件，实际停在 ${engine.updates}`);
  assert.ok(engine.heap.size > 0, '队列不应为空');
});

console.log('\n可复现性');

/** 给棋盘播种也要可复现，否则测的是 Math.random */
function seededBoard(board, density, seed) {
  let s = seed;
  const rng = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  board.randomize(density, rng);
}

test('同种子、同步长推进，结果逐格一致', () => {
  const run = () => {
    const { board, engine } = makeEngine({ seed: 424242, rate: 2.5, jitter: 0.4 });
    seededBoard(board, 0.35, 7);
    engine.reset(); // 播种要在随机棋盘之后
    for (let k = 0; k < 80; k++) engine.advance(0.15);
    return snapshot(board, engine) + '|' + Array.from(engine.stamp).map((v) => v.toFixed(4)).join(',');
  };
  assert.equal(run(), run());
});

test('不同种子得到不同调度', () => {
  const run = (seed) => {
    const { board, engine } = makeEngine({ seed, rate: 2.5, jitter: 0.4 });
    seededBoard(board, 0.35, 7);
    engine.reset();
    for (let k = 0; k < 20; k++) engine.advance(0.15);
    // 比对每个格子的本地时间戳：它直接由种子的抖动序列决定
    return Array.from(engine.stamp).map((v) => v.toFixed(4)).join(',');
  };
  assert.notEqual(run(1), run(2));
});

test('改触发方式会重新播种，队列不会残留旧事件', () => {
  const { board, engine } = makeEngine({ rate: 2 });
  board.randomize(0.3);
  engine.advance(1);
  const before = engine.heap.size;

  engine.setOptions({ mode: 'trigger' });
  assert.equal(engine.simTime, 0, '重新播种应把仿真时间归零');
  assert.ok(engine.heap.size <= board.cells.length, '旧队列应被清空');
  assert.notEqual(before, -1);
});

console.log('\n统计');

test('统计字段自洽', () => {
  const { board, engine } = makeEngine({ rate: 2 });
  board.randomize(0.3);
  engine.reset();
  for (let k = 0; k < 30; k++) {
    const stats = engine.advance(0.25);
    assert.equal(stats.population, board.countAlive());
    assert.ok(stats.updates >= 0);
    assert.ok(stats.maxLag >= 0);
    assert.ok(stats.queue >= 0);
    assert.equal(stats.simTime, engine.simTime);
  }
  assert.ok(engine.updates > 0, '30 次推进后应该处理过事件');
  assert.equal(engine.generation, engine.updates);
});

console.log(`\n全部通过：${passed} 项\n`);
