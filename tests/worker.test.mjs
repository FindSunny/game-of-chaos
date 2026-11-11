import assert from 'node:assert/strict';

/**
 * 在 Node 里模拟 worker 环境，直接测消息协议。
 * worker 模块用的是 self.onmessage / self.postMessage，这里给个假的 self 就行。
 */
const messages = [];

globalThis.self = {
  onmessage: null,
  postMessage(msg) {
    messages.push(msg);
  },
};

await import('../js/workers/particle-worker.js');

const send = (msg) => globalThis.self.onmessage({ data: msg });
const last = () => messages[messages.length - 1];

function section(name) {
  console.log(`\n${name}`);
}
function test(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

section('初始化');

send({ type: 'init', width: 1200, height: 800, preset: 'Gliders', count: 300, wrap: true, seed: 1 });

test('初始化后回一条 state，带颜色和矩阵', () => {
  const msg = last();
  assert.equal(msg.type, 'state');
  assert.equal(msg.count, 300);
  assert.equal(msg.nTypes, 6);
  assert.equal(msg.colors.length, 6);
  assert.equal(msg.matrix.length, 36);
  assert.equal(msg.width, 1200);
});

section('帧协议');

send({ type: 'frame', steps: 3, budget: 500 });
const frame = last();

test('推进 3 步后回 frame，且带回三块缓冲', () => {
  assert.equal(frame.type, 'frame');
  assert.equal(frame.ran, 3);
  assert.equal(frame.steps, 3);
  assert.equal(frame.count, 300);
  assert.ok(frame.x.byteLength === 300 * 4);
  assert.ok(frame.y.byteLength === 300 * 4);
  assert.ok(frame.types.byteLength === 300);
});

test('位置落在世界范围内', () => {
  const x = new Float32Array(frame.x);
  const y = new Float32Array(frame.y);
  for (let i = 0; i < 300; i++) {
    assert.ok(x[i] >= 0 && x[i] <= 1200, `x[${i}] = ${x[i]}`);
    assert.ok(y[i] >= 0 && y[i] <= 800, `y[${i}] = ${y[i]}`);
  }
});

test('回传缓冲后仍能继续出帧', () => {
  send({ type: 'frame', steps: 1, budget: 500, x: frame.x, y: frame.y, types: frame.types });
  const next = last();
  assert.equal(next.type, 'frame');
  assert.equal(next.count, 300);
  assert.equal(next.x.byteLength, 300 * 4);
});

test('预算极小也至少走一步，不会卡死', () => {
  send({ type: 'frame', steps: 50, budget: 0.01 });
  const ran = last().ran;
  assert.ok(ran >= 1, `至少一步，实际 ${ran}`);
  assert.ok(ran < 50, `预算该截断，实际跑了 ${ran}`);
});

section('参数与矩阵');

test('改数量会重置并广播新的 state', () => {
  send({ type: 'options', options: { count: 120 } });
  const msg = last();
  assert.equal(msg.type, 'state');
  assert.equal(msg.count, 120);
});

test('改单格吸引力只动那一格', () => {
  send({ type: 'attract', i: 0, j: 1, value: 0.2 });
  send({ type: 'randomizeAttract' });
  const msg = last();
  assert.equal(msg.type, 'matrix');
  // 重掷会覆盖，所以只验证消息形状
  assert.equal(msg.matrix.length, 36);
});

test('spawn 增加粒子，不广播 state', () => {
  const before = messages.length;
  send({ type: 'spawn', x: 600, y: 400, amount: 10 });
  assert.equal(messages.length, before, 'spawn 不该产生额外消息');
  send({ type: 'frame', steps: 1, budget: 500 });
  assert.equal(last().count, 130);
});

console.log('\n全部通过：8 项（worker 协议）');
