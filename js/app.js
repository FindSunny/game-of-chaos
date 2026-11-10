/**
 * 应用装配层：把网格、引擎、渲染、输入、面板控件接起来。
 *
 * 演化与渲染分离：引擎只管推进状态，渲染每帧读一次数据，
 * 所以暂停时依然能绘制、绘制时依然能实时看到下一帧结果。
 */
import { Board } from './core/board.js';
import { Engine } from './core/engine.js';
import { parseRule, RULE_PRESETS } from './core/rules.js';
import { Renderer } from './ui/renderer.js';
import { PATTERNS, rotatePattern } from './ui/patterns.js';

const STORAGE_KEY = 'goc.settings.v1';
const HISTORY_LIMIT = 320;
const MAX_STEPS_PER_FRAME = 24;
const COLORS = { accent: '#35e0c8' };

const $ = (id) => document.getElementById(id);

/* ---------- 设置持久化 ---------- */

const DEFAULTS = {
  rule: 'B3/S23',
  speed: 10,
  density: 0.3,
  width: 160,
  height: 100,
  wrap: true,
  grid: true,
  age: true,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULTS, ...parsed };
    // 尺寸做一次校验，避免存进去的脏数据把画布搞崩
    if (!Number.isInteger(merged.width) || !Number.isInteger(merged.height)) {
      merged.width = DEFAULTS.width;
      merged.height = DEFAULTS.height;
    }
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 隐私模式下写不进去，忽略即可 */
  }
}

const state = loadSettings();

/* ---------- 核心对象 ---------- */

const board = new Board(state.width, state.height, state.wrap);
let rule = parseRule(state.rule);
const engine = new Engine(board, rule);
const renderer = new Renderer($('board'));
const canvas = $('board');

/** 运行期状态（不进 localStorage） */
const ui = {
  running: false,
  hover: null,
  pending: null, // { id, label, cells }
  painting: false,
  paintValue: 1,
  lastPaint: null,
};

const history = [];

/* ---------- 演化循环 ---------- */

let lastFrame = performance.now();
let accumulator = 0;

function tick() {
  engine.step();
  recordHistory(engine.stats.population);
}

function loop(now) {
  const dt = Math.min(now - lastFrame, 200);
  lastFrame = now;

  if (ui.running) {
    const interval = 1000 / state.speed;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= interval && steps < MAX_STEPS_PER_FRAME) {
      tick();
      accumulator -= interval;
      steps++;
    }
    // 一帧内追不上目标速度时丢掉欠账，避免越积越多
    if (steps >= MAX_STEPS_PER_FRAME) accumulator = 0;
  } else {
    accumulator = 0;
  }

  render();
  syncStats();
  requestAnimationFrame(loop);
}

function render() {
  renderer.draw(board, engine, {
    colorByAge: state.age,
    showGrid: state.grid,
    hover: ui.hover,
    ghost: ui.pending ? ui.pending.cells : null,
  });
}

/* ---------- 统计与曲线 ---------- */

function setText(el, value) {
  const text = String(value);
  if (el.textContent !== text) el.textContent = text;
}

function syncStats() {
  setText($('stat-gen'), engine.generation);
  setText($('stat-pop'), engine.stats.population);
  setText($('stat-born'), engine.stats.births);
  setText($('stat-died'), engine.stats.deaths);
}

function recordHistory(population) {
  history.push(population);
  if (history.length > HISTORY_LIMIT) history.shift();
  drawSpark();
}

function drawSpark() {
  const el = $('spark');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (!w || !h) return;

  if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
  }

  const ctx = el.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (history.length < 2) return;

  const max = Math.max(4, ...history);
  const stepX = w / (history.length - 1);
  const points = history.map((value, i) => [
    i * stepX,
    h - 3 - (value / max) * (h - 6),
  ]);

  // 面积填充
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.lineTo(w, h);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, 'rgba(53, 224, 200, 0.28)');
  gradient.addColorStop(1, 'rgba(53, 224, 200, 0)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // 折线
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/* ---------- 播放控制 ---------- */

function setRunning(running) {
  ui.running = running;
  const btn = $('btn-play');
  btn.textContent = running ? '❚❚ 暂停' : '▶ 播放';
  btn.classList.toggle('primary', !running);
}

function stepOnce() {
  if (ui.running) setRunning(false);
  tick();
}

function clearBoard() {
  board.clear();
  engine.resetCounters();
  history.length = 0;
  drawSpark();
}

function randomizeBoard() {
  board.randomize(state.density);
  engine.resetCounters();
  history.length = 0;
  drawSpark();
}

/* ---------- 绘制（鼠标/触控） ---------- */

function paintCell(x, y, value) {
  const i = y * board.width + x;
  board.cells[i] = value;
  engine.age[i] = value ? 1 : 0;
}

/** 两点之间用 Bresenham 补格，快速拖动时不会断线 */
function paintLine(from, to, value) {
  let { x: x0, y: y0 } = from;
  const { x: x1, y: y1 } = to;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  for (;;) {
    paintCell(x0, y0, value);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function stampPattern(origin) {
  for (const [dx, dy] of ui.pending.cells) {
    const i = board.index(origin.x + dx, origin.y + dy);
    if (i < 0) continue;
    board.cells[i] = 1;
    engine.age[i] = 1;
  }
  engine.stats.population = board.countAlive();
}

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

canvas.addEventListener('pointerdown', (event) => {
  const cell = renderer.pick(event, board);
  if (!cell) return;

  if (ui.pending) {
    stampPattern(cell);
    render();
    return;
  }

  canvas.setPointerCapture(event.pointerId);
  ui.painting = true;
  ui.paintValue = event.button === 2 || event.shiftKey ? 0 : 1;
  ui.lastPaint = cell;
  paintCell(cell.x, cell.y, ui.paintValue);
  render();
});

canvas.addEventListener('pointermove', (event) => {
  const cell = renderer.pick(event, board);
  ui.hover = cell;

  if (!ui.painting || !cell) return;
  if (ui.lastPaint && (ui.lastPaint.x !== cell.x || ui.lastPaint.y !== cell.y)) {
    paintLine(ui.lastPaint, cell, ui.paintValue);
  } else {
    paintCell(cell.x, cell.y, ui.paintValue);
  }
  ui.lastPaint = cell;
});

canvas.addEventListener('pointerup', (event) => {
  if (!ui.painting) return;
  ui.painting = false;
  ui.lastPaint = null;
  engine.stats.population = board.countAlive();
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener('pointerleave', () => {
  ui.hover = null;
});

/* ---------- 图样面板 ---------- */

function selectPattern(pattern) {
  if (ui.pending && ui.pending.id === pattern.id) {
    ui.pending = null;
  } else {
    ui.pending = { id: pattern.id, label: pattern.label, cells: pattern.cells };
  }
  renderPatternButtons();
}

function renderPatternButtons() {
  const container = $('patterns');
  container.innerHTML = '';
  for (const pattern of PATTERNS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pattern-btn';
    btn.textContent = pattern.label;
    btn.classList.toggle('active', ui.pending?.id === pattern.id);
    btn.addEventListener('click', () => selectPattern(pattern));
    container.appendChild(btn);
  }
}

/* ---------- 面板绑定 ---------- */

function applyRule(text) {
  const input = $('rule-input');
  const error = $('rule-error');
  try {
    rule = parseRule(text);
    engine.setRule(rule);
    input.value = rule.text;
    input.classList.remove('invalid');
    error.textContent = '';
    state.rule = rule.text;
    saveSettings();
  } catch {
    input.classList.add('invalid');
    error.textContent = '格式应为 B3/S23';
  }
}

function populateRulePresets() {
  const select = $('rule-preset');
  for (const preset of RULE_PRESETS) {
    const option = document.createElement('option');
    option.value = preset.rule;
    option.textContent = `${preset.name} · ${preset.rule}`;
    option.title = preset.notes;
    select.appendChild(option);
  }
}

function bindControls() {
  $('rule-apply').addEventListener('click', () => applyRule($('rule-input').value));
  $('rule-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyRule($('rule-input').value);
  });
  $('rule-input').addEventListener('input', () => $('rule-input').classList.remove('invalid'));
  $('rule-preset').addEventListener('change', (event) => {
    const value = event.target.value;
    if (!value) return;
    applyRule(value);
    event.target.value = '';
  });

  $('btn-play').addEventListener('click', () => setRunning(!ui.running));
  $('btn-step').addEventListener('click', stepOnce);
  $('btn-clear').addEventListener('click', clearBoard);
  $('btn-random').addEventListener('click', randomizeBoard);

  const speed = $('speed');
  speed.value = state.speed;
  $('speed-val').textContent = `${state.speed} 代/秒`;
  speed.addEventListener('input', () => {
    state.speed = Number(speed.value);
    $('speed-val').textContent = `${state.speed} 代/秒`;
    saveSettings();
  });

  const density = $('density');
  density.value = Math.round(state.density * 100);
  $('density-val').textContent = `${density.value}%`;
  density.addEventListener('input', () => {
    state.density = Number(density.value) / 100;
    $('density-val').textContent = `${density.value}%`;
    saveSettings();
  });

  const wrap = $('opt-wrap');
  wrap.checked = state.wrap;
  wrap.addEventListener('change', () => {
    board.wrap = wrap.checked;
    state.wrap = wrap.checked;
    saveSettings();
  });

  const grid = $('opt-grid');
  grid.checked = state.grid;
  grid.addEventListener('change', () => {
    state.grid = grid.checked;
    saveSettings();
  });

  const age = $('opt-age');
  age.checked = state.age;
  age.addEventListener('change', () => {
    state.age = age.checked;
    saveSettings();
  });

  const size = $('board-size');
  size.value = `${state.width}x${state.height}`;
  if (!size.value) size.value = '160x100';
  size.addEventListener('change', () => {
    const [w, h] = size.value.split('x').map(Number);
    board.resize(w, h);
    engine.setBoard(board);
    history.length = 0;
    drawSpark();
    state.width = w;
    state.height = h;
    saveSettings();
    renderer.resize();
    render();
  });
}

/* ---------- 键盘 ---------- */

function onKeydown(event) {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;

  switch (event.key) {
    case ' ':
      event.preventDefault();
      setRunning(!ui.running);
      break;
    case '.':
    case 's':
      event.preventDefault();
      stepOnce();
      break;
    case 'c':
      clearBoard();
      break;
    case 'r':
      // 选中图样时 R 用来旋转，否则是重新随机
      if (ui.pending) {
        ui.pending.cells = rotatePattern(ui.pending.cells);
      } else {
        randomizeBoard();
      }
      break;
    case 'g':
      $('opt-grid').click();
      break;
    case 'Escape':
      ui.pending = null;
      renderPatternButtons();
      break;
    default:
      break;
  }
}

/* ---------- 启动 ---------- */

function boot() {
  populateRulePresets();
  bindControls();
  renderPatternButtons();
  setRunning(false);

  const resizeObserver = new ResizeObserver(() => {
    // resize 会重置画布像素尺寸（等于清空），必须立刻补画一帧，
    // 否则要等下一个 animation frame 才有内容
    renderer.resize();
    render();
    drawSpark();
  });
  resizeObserver.observe($('stage'));
  resizeObserver.observe($('spark'));

  document.addEventListener('keydown', onKeydown);

  // 首屏给一点随机图样，直接能玩
  if (board.countAlive() === 0) randomizeBoard();

  renderer.resize();
  requestAnimationFrame(loop);
}

boot();
