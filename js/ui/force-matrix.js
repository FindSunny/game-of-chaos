/**
 * 作用力矩阵面板。
 *
 * 粒子之间唯一的规则就是这张 n×n 矩阵：第 i 行第 j 列 = 类型 i 受到类型 j 的吸引力。
 * 正数吸引、负数排斥，对角线（同类型）永远是负的。
 *
 * 画成色块：青=吸引，洋红=排斥，越深越强。点格子改数值（左键加、右键减），
 * 改完立刻生效，不用重新播种。
 */

const MAX_ABS = 0.12; // 颜色映射的满量程

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

  pick(event) {
    if (!this.engine) return null;
    const rect = this.canvas.getBoundingClientRect();
    const n = this.engine.nTypes;
    const size = Math.min(rect.width, rect.height);
    const cell = size / n;
    const i = Math.floor((event.clientY - rect.top) / cell);
    const j = Math.floor((event.clientX - rect.left) / cell);
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

    const n = engine.nTypes;
    const size = Math.min(w, h);
    const cell = size / n;
    // 居中，留出一点边
    const ox = (w - size) / 2;
    const oy = (h - size) / 2;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const value = engine.getAttract(i, j);
        ctx.fillStyle = colorFor(value);
        ctx.fillRect(ox + j * cell, oy + i * cell, cell - 1, cell - 1);
      }
    }

    // 悬停高亮
    if (this.hover.i !== null) {
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        ox + this.hover.j * cell + 0.5,
        oy + this.hover.i * cell + 0.5,
        cell - 2,
        cell - 2,
      );
    }
  }
}
