/**
 * 应用装配层：把网格、引擎、渲染、输入、面板控件接起来。
 *
 * 现在有两套规则引擎，接口一致（step / stats / generation / age / setBoard）：
 *   - Engine       生命游戏，二进制状态 + B/S 规则
 *   - WuxingEngine 五行生克，六态（空 + 木火土金水）
 * 切换模式只换引擎实例，循环、渲染、输入都不用改。
 */
import { Board } from './core/board.js';
import { Engine } from './core/engine.js';
import { parseRule, RULE_PRESETS } from './core/rules.js';
import { WuxingEngine, WUXING_STATES, PARAM_PRESETS, seedWorld } from './core/wuxing.js';
import { Renderer } from './ui/renderer.js';
import { PATTERNS, rotatePattern } from './ui/patterns.js';
import { drawRing } from './ui/ring.js';
import { drawSeries } from './ui/timeseries.js';

const STORAGE_KEY = 'goc.settings.v1';
const HISTORY_LIMIT = 320;
const SERIES_LIMIT = 240;
const MAX_STEPS_PER_FRAME = 24;
const ACCENT = '#35e0c8';

const $ = (id) => document.getElementById(id);

/* ---------- 设置持久化 ---------- */

const DEFAULTS = {
  mode: 'life',
  rule: 'B3/S23',
  grow: 3,
  kill: 3,
  speed: 10,
  density: 0.3,
  width: 160,
  height: 100,
  wrap: true,
  grid: true,
  age: true,
  brush: 1,
  isolate: 0,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const merged = { ...DEFAULTS, ...JSON.parse(raw) };
    if (!Number.isInteger(merged.width) || !Number.isInteger(merged.height)) {
      merged.width = DEFAULTS.width;
      merged.height = DEFAULTS.height;
    }
    if (merged.mode !== 'life' && merged.mode !== 'wuxing') merged.mode = DEFAULTS.mode;
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 隐私模式写不进去，忽略即可 */
  }
}

const state = loadSettings();

/* ---------- 核心对象 ---------- */

const board = new Board(state.width, state.height, state.wrap);
const renderer = new Renderer($('board'));
const canvas = $('board');

/** 生命游戏规则，切到五行模式时保留着，切回来不用重设 */
let lifeRule = safeParseRule(state.rule);

function safeParseRule(text) {
  try {
    return parseRule(text);
  } catch {
    return parseRule(DEFAULTS.rule);
  }
}

function createEngine() {
  if (state.mode === 'wuxing') {
    return new WuxingEngine(board, { grow: state.grow, kill: state.kill });
  }
  return new Engine(board, lifeRule);
}

let engine = createEngine();

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

/** 五条状态曲线，索引 0 对应木；只存数字，绘制时再归一化 */
const series = [[], [], [], [], []];

/** 五行配色表，下标即状态值 */
const WUXING_PALETTE = WUXING_STATES.map((s) => s.color);
const WUXING_NAMES = WUXING_STATES.map((s) => s.name);

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
    palette: state.mode === 'wuxing' ? WUXING_PALETTE : null,
    isolate: state.mode === 'wuxing' ? state.isolate : 0,
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
  setText($('stat-trans'), engine.stats.transitions ?? 0);
}

function recordHistory(population) {
  history.push(population);
  if (history.length > HISTORY_LIMIT) history.shift();

  if (state.mode === 'wuxing') {
    const totals = engine.stats.flows?.totals;
    if (totals) {
      for (let s = 0; s < 5; s++) series[s].push(totals[s + 1]);
      if (series[0].length > SERIES_LIMIT) {
        for (const line of series) line.shift();
      }
    }
  }

  drawCharts();
}

function resetSeries() {
  for (const line of series) line.length = 0;
}

/** 按当前模式挑图表：生命游戏看总人口曲线，五行看五态曲线 + 流向环 */
function drawCharts() {
  if (state.mode === 'wuxing') {
    drawSeries($('flow-chart'), series, WUXING_PALETTE);
    const flows = engine.stats.flows;
    if (flows) {
      drawRing($('ring'), {
        totals: flows.totals,
        flows,
        palette: WUXING_PALETTE,
        names: WUXING_NAMES,
      });
    }
  } else {
    drawSpark();
  }
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
  const points = history.map((value, i) => [i * stepX, h - 3 - (value / max) * (h - 6)]);

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

  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = ACCENT;
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
  resetSeries();
  drawCharts();
}

/** 按当前模式重新播种 */
function randomizeBoard() {
  if (state.mode === 'wuxing') {
    seedWorld(board, state.density);
  } else {
    board.randomize(state.density);
  }
  engine.resetCounters();
  history.length = 0;
  resetSeries();
  drawCharts();
}

/* ---------- 模式 ---------- */

function applyModeUI() {
  const wuxing = state.mode === 'wuxing';
  $('rule-life').hidden = wuxing;
  $('rule-wuxing').hidden = !wuxing;
  $('brush-block').hidden = !wuxing;
  $('wuxing-block').hidden = !wuxing;
  $('ring-block').hidden = !wuxing;
  $('patterns-block').hidden = wuxing;
  $('opt-age-row').hidden = wuxing;
  $('stat-transition-card').hidden = !wuxing;
  $('spark').hidden = wuxing;
  $('flow-chart').hidden = !wuxing;
  $('mode-life').classList.toggle('is-active', !wuxing);
  $('mode-wuxing').classList.toggle('is-active', wuxing);
  updateWuxingReadout();
  renderBrushChips();
  renderLegend();
  renderPresets();
}

function updateWuxingReadout() {
  $('wuxing-readout').textContent = `生长 ≥ ${state.grow} · 克制 ≥ ${state.kill}`;
}

function switchMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  setRunning(false);
  ui.pending = null;
  engine = createEngine();
  randomizeBoard();
  applyModeUI();
  saveSettings();
  render();
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

/** 当前画笔写入的状态值：生命游戏恒为 1，五行模式取所选元素 */
function brushValue() {
  return state.mode === 'wuxing' ? state.brush : 1;
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
  ui.paintValue = event.button === 2 || event.shiftKey ? 0 : brushValue();
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

/* ---------- 图样面板（生命游戏） ---------- */

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

/* ---------- 元素画笔 ---------- */

function setBrush(value) {
  state.brush = value;
  saveSettings();
  renderBrushChips();
}

function renderBrushChips() {
  const container = $('brush-chips');
  container.innerHTML = '';

  for (const meta of WUXING_STATES.slice(1)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.classList.toggle('active', state.brush === meta.value);
    btn.style.color = state.brush === meta.value ? meta.color : '';
    const dot = document.createElement('i');
    dot.style.background = meta.color;
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(meta.name));
    btn.addEventListener('click', () => setBrush(meta.value));
    container.appendChild(btn);
  }

  const eraser = document.createElement('button');
  eraser.type = 'button';
  eraser.className = 'chip';
  eraser.classList.toggle('active', state.brush === 0);
  const dot = document.createElement('i');
  dot.className = 'hollow';
  eraser.appendChild(dot);
  eraser.appendChild(document.createTextNode('擦除'));
  eraser.addEventListener('click', () => setBrush(0));
  container.appendChild(eraser);
}

function renderLegend() {
  const legend = $('legend');
  legend.innerHTML = '';
  for (const meta of WUXING_STATES.slice(1)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.classList.toggle('is-active', state.isolate === meta.value);
    btn.style.color = state.isolate === meta.value ? meta.color : '';
    const dot = document.createElement('i');
    dot.style.background = meta.color;
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(meta.name));
    btn.title = `只看${meta.name}`;
    btn.addEventListener('click', () => setIsolate(meta.value));
    legend.appendChild(btn);
  }
}

/** 单态隔离：只让选中的元素保持原色，其余压暗，用来观察单一元素的扩张形状 */
function setIsolate(value) {
  state.isolate = state.isolate === value ? 0 : value;
  saveSettings();
  renderLegend();
  render();
}

/* ---------- 生克参数与预设 ---------- */

function applyParams(grow, kill) {
  state.grow = grow;
  state.kill = kill;

  $('wuxing-grow').value = grow;
  $('wuxing-kill').value = kill;
  $('wuxing-grow-val').textContent = `≥ ${grow}`;
  $('wuxing-kill-val').textContent = `≥ ${kill}`;

  if (engine.setOptions) engine.setOptions({ grow, kill });
  updateWuxingReadout();
  renderPresets();
  saveSettings();
}

function renderPresets() {
  const box = $('param-presets');
  box.innerHTML = '';
  for (const preset of PARAM_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-btn';
    btn.textContent = preset.label;
    btn.title = `${preset.hint}（生长 ≥ ${preset.grow} · 克制 ≥ ${preset.kill}）`;
    btn.classList.toggle('is-active', state.grow === preset.grow && state.kill === preset.kill);
    btn.addEventListener('click', () => applyParams(preset.grow, preset.kill));
    box.appendChild(btn);
  }
}

/* ---------- 面板绑定 ---------- */

function applyRule(text) {
  const input = $('rule-input');
  const error = $('rule-error');
  try {
    lifeRule = parseRule(text);
    if (engine.setRule) engine.setRule(lifeRule);
    input.value = lifeRule.text;
    input.classList.remove('invalid');
    error.textContent = '';
    state.rule = lifeRule.text;
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
  $('mode-life').addEventListener('click', () => switchMode('life'));
  $('mode-wuxing').addEventListener('click', () => switchMode('wuxing'));

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

  const grow = $('wuxing-grow');
  grow.value = state.grow;
  $('wuxing-grow-val').textContent = `≥ ${state.grow}`;
  grow.addEventListener('input', () => applyParams(Number(grow.value), state.kill));

  const kill = $('wuxing-kill');
  kill.value = state.kill;
  $('wuxing-kill-val').textContent = `≥ ${state.kill}`;
  kill.addEventListener('input', () => applyParams(state.grow, Number(kill.value)));

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
    engine.resetCounters();
    history.length = 0;
    resetSeries();
    state.width = w;
    state.height = h;
    saveSettings();
    renderer.resize();
    render();
    drawCharts();
  });
}

/* ---------- 键盘 ---------- */

function onKeydown(event) {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;

  if (state.mode === 'wuxing' && /^[0-5]$/.test(event.key)) {
    setBrush(Number(event.key));
    return;
  }

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
  applyModeUI();
  setRunning(false);

  $('rule-input').value = lifeRule.text;
  $('wuxing-grow').value = state.grow;
  $('wuxing-kill').value = state.kill;

  const resizeObserver = new ResizeObserver(() => {
    // resize 会重置画布像素尺寸（等于清空），必须立刻补画一帧
    renderer.resize();
    render();
    drawCharts();
  });
  resizeObserver.observe($('stage'));
  resizeObserver.observe($('spark'));
  resizeObserver.observe($('flow-chart'));
  resizeObserver.observe($('ring'));

  document.addEventListener('keydown', onKeydown);

  // 首屏直接给一个能玩的初始状态
  if (board.countAlive() === 0) randomizeBoard();

  renderer.resize();
  render();
  drawCharts();
  requestAnimationFrame(loop);
}

boot();
