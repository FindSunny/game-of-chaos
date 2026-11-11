/**
 * 作用力矩阵面板。
 *
 * 粒子之间唯一的规则就是这张 n×n 矩阵：第 i 行第 j 列 = 类型 i 受到类型 j 的吸引力。
 * 正数吸引、负数排斥，对角线（同类型）永远是负的。
 *
 * 画成色块：青=吸引，洋红=排斥，越深越强。上下各留一条色标带，
 * 左边一行标「受力方」，顶上一列标「作用方」，靠颜色认类型。
 *
 * 点格子改数值（左键加、右键减），改完立刻生效，不用重新播种。
 */

const MAX_ABS = 0.12; // 颜色映射的满量程
const LABEL = 18; // 行列色标带宽度（CSS 像素）

/** -MAX_ABS..MAX_ABS 映射到 青 ↔ 黑 ↔ 洋红 */
function colorFor(value) {
  const t = Math.max(-1, Math.min(1, value / MAX_ABS));
  if (t >= 0) {
    const a = 0.15 + 0.85 * t;
    return `rgba(53, 224, 200, ${a.toFixed(3)})`;
  }
  const a = 0.15 + 0.85 * -t;
  return `rgba(244, 114, 182, ${a.toFixed(3)})`;
}

export class ForceMatrix {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {(i:number, j:number, delta:number) => void} onChange
   * @param {(i:number|null, j:number|null) => void} onHover
   */
  constructor(canvas, onChange, onHover) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange;
    this.onHover = onHover;
    this.hover = { i: null, j: null };
    this.engine = null;

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      const cell = this.pick(e);
      if (!cell) return;
      const delta = e.button === 2 || e.shiftKey ? -0.01 : 0.01;
      this.onChange(cell.i, cell.j, delta);
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        const cell = this.pick(e);
        if (!cell) return;
        e.preventDefault();
        this.onChange(cell.i, cell.j, e.deltaY > 0 ? -0.005 : 0.005);
      },
      { passive: false },
    );
    canvas.addEventListener('pointermove', (e) => {
      const cell = this.pick(e);
      const next = cell || { i: null, j: null };
      if (next.i !== this.hover.i || next.j !== this.hover.j) {
        this.hover = next;
        this.onHover(next.i, next.j);
        this.draw();
      }
    });
    canvas.addEventListener('pointerleave', () => {
      this.hover = { i: null, j: null };
      this.onHover(null, null);
      this.draw();
    });
  }

  /** 网格在画布里的位置：留出左侧和顶部的色标带 */
  geometry() {
    const engine = this.engine;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const n = engine ? engine.nTypes : 1;
    const grid = Math.max(20, Math.min(w - LABEL, h - LABEL));
    const cell = grid / n;
    return {
      n,
      cell,
      ox: (w - grid) / 2 + LABEL / 2,
      oy: (h - grid) / 2 + LABEL / 2,
      size: grid,
    };
  }

  pick(event) {
    if (!this.engine) return null;
    const rect = this.canvas.getBoundingClientRect();
    const { n, cell, ox, oy } = this.geometry();
    const x = event.clientX - rect.left - ox;
    const y = event.clientY - rect.top - oy;
    const i = Math.floor(y / cell);
    const j = Math.floor(x / cell);
    if (i < 0 || j < 0 || i >= n || j >= n) return null;
    return { i, j };
  }

  setEngine(engine) {
    this.engine = engine;
    this.draw();
  }

  draw() {
    const engine = this.engine;
    if (!engine) return;
    const canvas = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a1219';
    ctx.fillRect(0, 0, w, h);

    const { n, cell, ox, oy } = this.geometry();
    const colors = engine.colors || [];

    // 格子
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = colorFor(engine.getAttract(i, j));
        ctx.fillRect(ox + j * cell, oy + i * cell, Math.max(1, cell - 1), Math.max(1, cell - 1));
      }
    }

    // 顶部色标：列 = 作用方
    for (let j = 0; j < n; j++) {
      ctx.fillStyle = colors[j] || '#35e0c8';
      ctx.fillRect(ox + j * cell + 1, 2, Math.max(1, cell - 2), 7);
    }

    // 左侧色标：行 = 受力方
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colors[i] || '#35e0c8';
      ctx.fillRect(2, oy + i * cell + 1, 7, Math.max(1, cell - 2));
    }

    // 行列序号：格子够大才画，否则只靠颜色
    if (cell >= 16) {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let j = 0; j < n; j++) {
        ctx.fillText(String(j), ox + j * cell + cell / 2, 14);
      }
      for (let i = 0; i < n; i++) {
        ctx.fillText(String(i), 14, oy + i * cell + cell / 2);
      }
    }

    // 轴名：列在顶部、行在左侧，各留一个角落文字
    ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.font = '9px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('作用方 →', w - 4, 10);
    ctx.save();
    ctx.translate(10, h - 4);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'right';
    ctx.fillText('受力方 →', 0, 0);
    ctx.restore();

    // 悬停高亮
    if (this.hover.i !== null) {
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        ox + this.hover.j * cell + 0.5,
        oy + this.hover.i * cell + 0.5,
        Math.max(1, cell - 2),
        Math.max(1, cell - 2),
      );
    }
  }
}
