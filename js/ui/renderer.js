/**
 * 渲染层：只认网格数据，不参与演化计算。
 *
 * 用 Canvas 2D 逐格绘制。格子数在几万级别、存活率通常 5% 上下，
 * 逐格 fillRect 足够快，不需要做区块缓存。
 *
 * 细胞颜色按「连续存活代数」渐变：刚出生的偏暗青，活得久的偏亮青白，
 * 这样一眼能看出哪些结构在移动、哪些已经稳定下来。
 */

/** 单态隔离时其余元素的颜色：压成暗灰，保留形状但不抢眼 */
const DIM_COLOR = 'rgba(148, 163, 184, 0.18)';

import { xOf, yOf } from '../core/sparse-world.js';
import { ParticleGL } from './particle-gl.js';

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas 主画布（网格、粒子背景、悬停框）
   * @param {HTMLCanvasElement} [particleCanvas] 粒子专用的叠加画布（WebGL）
   */
  constructor(canvas, particleCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cell = 6;
    this.ox = 0;
    this.oy = 0;

    // 粒子用 WebGL 叠加层渲染；拿不到上下文时为 null，走 Canvas 2D 回退
    this.particleGL = particleCanvas ? new ParticleGL(particleCanvas) : null;
    // 便于排查「到底走的哪条路」，也方便自动化测试断言
    document.body.dataset.particles = this.particleGL && this.particleGL.ok ? 'webgl' : 'canvas2d';

    /** 相机：zoom = 每格多少像素，ox/oy = 网格左上角在画布上的位置 */
    this.camera = { zoom: 8, ox: 0, oy: 0 };
    this.fitZoom = 8;
    this.minZoom = 0.15;
    this.maxZoom = 40;

    // 年龄色阶：索引越大表示活得越久
    this.ramp = [
      '#0e7490',
      '#0891b2',
      '#06b6d4',
      '#22d3ee',
      '#67e8f9',
      '#a5f3fc',
      '#cffafe',
      '#ecfeff',
    ];
  }

  /** 画布像素尺寸跟随 CSS 尺寸，按设备像素比放大保证清晰 */
  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  /**
   * 适应窗口：把整张网格装进画布并居中
   * @param {import('../core/board.js').Board} board
   */
  fit(board) {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (!cw || !ch) return;

    const zoom = Math.max(
      this.minZoom,
      Math.min(this.maxZoom, Math.floor(Math.min(cw / board.width, ch / board.height))),
    );
    this.fitZoom = zoom;
    this.camera.zoom = zoom;
    this.camera.ox = Math.round((cw - board.width * zoom) / 2);
    this.camera.oy = Math.round((ch - board.height * zoom) / 2);
  }

  /**
   * 以画布内的某个点为锚缩放（滚轮缩放就是用它）
   * @param {number} px 画布坐标
   * @param {number} py 画布坐标
   * @param {number} factor >1 放大，<1 缩小
   */
  zoomAt(px, py, factor) {
    const camera = this.camera;
    const next = Math.max(this.minZoom, Math.min(this.maxZoom, camera.zoom * factor));
    if (Math.abs(next - camera.zoom) < 1e-6) return;

    // 锚点下方的世界坐标在缩放前后保持不动
    const wx = (px - camera.ox) / camera.zoom;
    const wy = (py - camera.oy) / camera.zoom;
    camera.zoom = next;
    camera.ox = px - wx * next;
    camera.oy = py - wy * next;
  }

  panBy(dx, dy) {
    this.camera.ox += dx;
    this.camera.oy += dy;
  }

  /**
   * 平移限位：至少把网格的一角留在画布里，避免拖丢
   * @param {import('../core/board.js').Board} board
   */
  clampCamera(board) {
    if (board.isSparse) return; // 无限世界没有可夹的边界
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    const w = board.width * this.camera.zoom;
    const h = board.height * this.camera.zoom;
    const margin = 60;
    this.camera.ox = Math.min(cw - margin, Math.max(margin - w, this.camera.ox));
    this.camera.oy = Math.min(ch - margin, Math.max(margin - h, this.camera.oy));
  }

  /** 把相机状态同步成绘制用的格宽与偏移 */
  measure() {
    this.cell = this.camera.zoom;
    this.ox = this.camera.ox;
    this.oy = this.camera.oy;
  }

  /** 把某个世界坐标移到画布中心（无限模式没有网格尺寸，没法 fit） */
  centerOn(wx, wy, zoom = this.camera.zoom) {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    this.camera.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    this.fitZoom = this.camera.zoom;
    this.camera.ox = Math.round(cw / 2 - wx * this.camera.zoom);
    this.camera.oy = Math.round(ch / 2 - wy * this.camera.zoom);
  }

  /** 把一块矩形世界（连续坐标，无格子）装进画布并居中 */
  fitWorld(width, height) {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (!cw || !ch) return;
    const zoom = Math.max(
      this.minZoom,
      Math.min(this.maxZoom, Math.min(cw / width, ch / height) * 0.95),
    );
    this.fitZoom = zoom;
    this.centerOn(width / 2, height / 2, zoom);
  }

  /**
   * 粒子世界：连续坐标，逐粒子画圆；开启描边时再沿速度方向画一段线
   * @param {import('../core/particle-life.js').ParticleLifeEngine} engine
   * @param {{showGrid: boolean, radius: number, hover: {x:number,y:number}|null, ghost: null, trace?: boolean}} opts
   */
  drawParticles(engine, opts) {
    const { ctx } = this;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (!cw || !ch) return;

    this.measure();
    const { cell: zoom, ox, oy } = this;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#05080c';
    ctx.fillRect(0, 0, cw, ch);

    // 世界边界
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, engine.width * zoom - 1, engine.height * zoom - 1);

    const trace = Boolean(opts.trace);
    // 描边模式下圆点画小一点，让速度线成为主体
    const r = Math.max(1, opts.radius * zoom * (trace ? 0.62 : 1));
    const colors = engine.colors;

    // 粒子本体：有 WebGL 就交给 GPU（一次 draw call），否则退回 Canvas 2D
    if (!trace && this.particleGL && this.particleGL.ok) {
      this.particleGL.draw(engine, { ox, oy, zoom, radius: opts.radius });
    } else if (!trace) {
      // 2D 回退：按类型攒成 Path2D，每类只 fill 一次
      const paths = new Map();
      for (let i = 0; i < engine.count; i++) {
        const px = ox + engine.x[i] * zoom;
        const py = oy + engine.y[i] * zoom;
        if (px < -r || py < -r || px > cw + r || py > ch + r) continue;

        const type = engine.type[i];
        let path = paths.get(type);
        if (!path) {
          path = new Path2D();
          paths.set(type, path);
        }
        path.moveTo(px + r, py);
        path.arc(px, py, r, 0, Math.PI * 2);
      }

      ctx.globalAlpha = 0.92;
      for (const [type, path] of paths) {
        ctx.fillStyle = colors[type] || '#35e0c8';
        ctx.fill(path);
      }
      ctx.globalAlpha = 1;
    } else {
      let currentType = -1;
      for (let i = 0; i < engine.count; i++) {
        const wx = engine.x[i];
        const wy = engine.y[i];
        const px = ox + wx * zoom;
        const py = oy + wy * zoom;
        if (px < -r - 24 || py < -r - 24 || px > cw + r + 24 || py > ch + r + 24) continue;

        const type = engine.type[i];
        if (type !== currentType) {
          const color = colors[type] || '#35e0c8';
          ctx.fillStyle = color;
          ctx.strokeStyle = color;
          currentType = type;
        }

        // 速度方向：长度随速度增长，但封顶，避免快的粒子拖出一条长线
        const vx = engine.vx[i];
        const vy = engine.vy[i];
        const speed = Math.hypot(vx, vy);
        if (speed > 0.02) {
          const len = Math.min(26, 6 + speed * 30);
          const ux = vx / speed;
          const uy = vy / speed;
          const tipX = px + ux * len;
          const tipY = py + uy * len;

          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(px + ux * r, py + uy * r);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();

          // 箭头两撇
          ctx.globalAlpha = 0.75;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - ux * 4 - uy * 2.4, tipY - uy * 4 + ux * 2.4);
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - ux * 4 + uy * 2.4, tipY - uy * 4 - ux * 2.4);
          ctx.stroke();
        }

        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (opts.hover) {
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
      ctx.beginPath();
      ctx.arc(ox + opts.hover.x * zoom, oy + opts.hover.y * zoom, r * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** 连续坐标拾取（粒子模式用） */
  pickWorld(ev) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left - this.ox) / this.cell,
      y: (ev.clientY - rect.top - this.oy) / this.cell,
    };
  }

  /**
   * @param {import('../core/board.js').Board} board
   * @param {import('../core/engine.js').Engine} engine
   * @param {{colorByAge: boolean, showGrid: boolean, hover: {x:number,y:number}|null, ghost: [number,number][]|null, palette: string[]|null}} opts
   */
  draw(board, engine, opts) {
    const { ctx } = this;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (!cw || !ch) return;

    if (board.isSparse) {
      this.drawSparse(board, opts);
      return;
    }

    this.measure();
    const { cell, ox, oy } = this;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#05080c';
    ctx.fillRect(0, 0, cw, ch);

    // 网格底板，比画布背景略亮，让边界看得见
    ctx.fillStyle = '#0a1119';
    ctx.fillRect(ox, oy, cell * board.width, cell * board.height);

    const inset = cell >= 5 ? 1 : 0;
    const size = cell - inset;

    // 因果波前：被事件访问过、但当前是空的格子，用极暗底色标出来。
    // 没有这一层，「波前扫过空地」在画面上完全不可见——空地本来不画。
    if (opts.ghostEmpty && opts.isVisited) {
      ctx.fillStyle = opts.ghostEmpty;
      for (let y = 0; y < board.height; y++) {
        const row = y * board.width;
        for (let x = 0; x < board.width; x++) {
          const i = row + x;
          if (board.cells[i] !== 0) continue;
          if (!opts.isVisited(i)) continue;
          ctx.fillRect(ox + x * cell, oy + y * cell, size, size);
        }
      }
    }

    // 细胞：按状态取色（五行）或按年龄取色（生命游戏），色值只在变化时切换
    let currentColor = '';
    for (let y = 0; y < board.height; y++) {
      const row = y * board.width;
      const py = oy + y * cell;
      for (let x = 0; x < board.width; x++) {
        const i = row + x;
        const value = board.cells[i];
        if (value === 0) continue;

        let color;
        if (opts.colorFor) {
          // 异步模式：按每个格子自己的本地时间取色
          color = opts.colorFor(i);
        } else if (opts.palette) {
          // 单态隔离时，其余元素压成暗灰，只留选中元素的原色
          color =
            opts.isolate && value !== opts.isolate
              ? DIM_COLOR
              : opts.palette[value] || '#35e0c8';
        } else if (opts.colorByAge) {
          color = this.ramp[Math.min(engine.age[i], this.ramp.length - 1)];
        } else {
          color = '#35e0c8';
        }

        if (color !== currentColor) {
          ctx.fillStyle = color;
          currentColor = color;
        }
        ctx.fillRect(ox + x * cell, py, size, size);
      }
    }

    // 网格线
    if (opts.showGrid && cell >= 5) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= board.width; x++) {
        const px = ox + x * cell + 0.5;
        ctx.moveTo(px, oy);
        ctx.lineTo(px, oy + cell * board.height);
      }
      for (let y = 0; y <= board.height; y++) {
        const py = oy + y * cell + 0.5;
        ctx.moveTo(ox, py);
        ctx.lineTo(ox + cell * board.width, py);
      }
      ctx.stroke();
    }

    // 待放置图样的预览
    if (opts.ghost && opts.hover) {
      ctx.fillStyle = 'rgba(53, 224, 200, 0.35)';
      for (const [gx, gy] of opts.ghost) {
        const x = opts.hover.x + gx;
        const y = opts.hover.y + gy;
        if (x < 0 || y < 0 || x >= board.width || y >= board.height) continue;
        ctx.fillRect(ox + x * cell, oy + y * cell, size, size);
      }
    }

    // 光标所在格子的高亮框
    if (opts.hover) {
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        ox + opts.hover.x * cell + 0.5,
        oy + opts.hover.y * cell + 0.5,
        cell - 1,
        cell - 1,
      );
    }

    // 外框
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, cell * board.width - 1, cell * board.height - 1);
  }

  /**
   * 稀疏世界：没有边界，只画视口内的部分。
   *
   * 两种遍历策略，按规模自动选：
   *   - 视口里的格子比活细胞少 → 逐个查视口
   *   - 反过来 → 直接遍历活细胞集合，跳过视口外的
   * 缩得很小时第二种更重要，否则一帧要查几十万次 Map。
   * @param {import('../core/sparse-world.js').SparseWorld} world
   * @param {{showGrid: boolean, hover: {x:number,y:number}|null, ghost: [number,number][]|null}} opts
   */
  drawSparse(world, opts) {
    const { ctx } = this;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;

    this.measure();
    const { cell, ox, oy } = this;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#05080c';
    ctx.fillRect(0, 0, cw, ch);

    const x0 = Math.floor(-ox / cell) - 1;
    const x1 = Math.ceil((cw - ox) / cell) + 1;
    const y0 = Math.floor(-oy / cell) - 1;
    const y1 = Math.ceil((ch - oy) / cell) + 1;

    const inset = cell >= 5 ? 1 : 0;
    const size = cell - inset;

    // 网格线：铺满视口，跟着世界坐标走
    if (opts.showGrid && cell >= 5) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        const px = Math.round(ox + x * cell) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, ch);
      }
      for (let y = y0; y <= y1; y++) {
        const py = Math.round(oy + y * cell) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(cw, py);
      }
      ctx.stroke();
    }

    // 世界原点，给个参照
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox - 8, oy + 0.5);
    ctx.lineTo(ox + 8, oy + 0.5);
    ctx.moveTo(ox + 0.5, oy - 8);
    ctx.lineTo(ox + 0.5, oy + 8);
    ctx.stroke();

    const visibleCells = (x1 - x0 + 1) * (y1 - y0 + 1);
    const aliveCount = world.cells.size;
    ctx.fillStyle = '#35e0c8';

    if (visibleCells <= aliveCount * 3) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (!world.has(x, y)) continue;
          ctx.fillRect(ox + x * cell, oy + y * cell, size, size);
        }
      }
    } else {
      for (const key of world.cells.keys()) {
        const x = xOf(key);
        const y = yOf(key);
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        ctx.fillRect(ox + x * cell, oy + y * cell, size, size);
      }
    }

    // 待放置图样的预览
    if (opts.ghost && opts.hover) {
      ctx.fillStyle = 'rgba(53, 224, 200, 0.35)';
      for (const [gx, gy] of opts.ghost) {
        const x = opts.hover.x + gx;
        const y = opts.hover.y + gy;
        ctx.fillRect(ox + x * cell, oy + y * cell, size, size);
      }
    }

    // 光标所在格子
    if (opts.hover) {
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        ox + opts.hover.x * cell + 0.5,
        oy + opts.hover.y * cell + 0.5,
        cell - 1,
        cell - 1,
      );
    }
  }

  /**
   * 事件坐标转格子坐标。稀疏世界没有边界，永远返回坐标；稠密网格界外返回 null
   * @param {PointerEvent} ev
   * @param {import('../core/board.js').Board|import('../core/sparse-world.js').SparseWorld} board
   */
  pick(ev, board) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left - this.ox) / this.cell);
    const y = Math.floor((ev.clientY - rect.top - this.oy) / this.cell);
    if (board.isSparse) return { x, y };
    if (x < 0 || y < 0 || x >= board.width || y >= board.height) return null;
    return { x, y };
  }
}
