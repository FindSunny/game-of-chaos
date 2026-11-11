/**
 * 粒子的 GPU 渲染：GL_POINTS + 一次 draw call。
 *
 * Canvas 2D 每画一个圆就是一次完整路径提交，1200 个就是 1200 次；
 * 这里所有粒子塞进一个顶点缓冲，一次 gl.drawArrays 画完。
 *
 * 每个顶点只有 5 个 float：世界坐标 (x, y) + 颜色 (r, g, b)。
 * 圆的形状交给片元着色器：gl_PointCoord 到中心距离 > 1 就丢弃，
 * 所以不需要四边形几何，也不需要对每个粒子设置尺寸。
 *

 * 失败时（无 WebGL 上下文）返回 null，调用方退回到 Canvas 2D 路径。
 */

const VERT = `
attribute vec2 a_pos;
attribute vec3 a_color;
uniform vec2 u_resolution;
uniform vec2 u_origin;
uniform float u_zoom;
uniform float u_radius;
varying vec3 v_color;

void main() {
  vec2 screen = a_pos * u_zoom + u_origin;
  vec2 clip = vec2(screen.x / u_resolution.x * 2.0 - 1.0,
                   1.0 - screen.y / u_resolution.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = max(1.5, u_radius * u_zoom * 2.0);
  v_color = a_color;
}
`;

const FRAG = `
precision mediump float;
varying vec3 v_color;

void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  // 边缘一像素软化，缩小之后不会锯齿
  float alpha = smoothstep(1.0, 0.72, r2);
  gl_FragColor = vec4(v_color, alpha);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`着色器编译失败: ${log}`);
  }
  return shader;
}

function parseColor(str) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(str || '');
  if (!m) return [1, 1, 1];
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
}

export class ParticleGL {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.ok = false;
    this.capacity = 0;
    this.data = null;
    this.colorCache = null;
    this.colorTable = null;
    this.dpr = 1;

    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) return;
    this.gl = gl;

    try {
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`着色器链接失败: ${gl.getProgramInfoLog(program)}`);
      }
      this.program = program;
      gl.useProgram(program);

      this.aPos = gl.getAttribLocation(program, 'a_pos');
      this.aColor = gl.getAttribLocation(program, 'a_color');
      this.uResolution = gl.getUniformLocation(program, 'u_resolution');
      this.uOrigin = gl.getUniformLocation(program, 'u_origin');
      this.uZoom = gl.getUniformLocation(program, 'u_zoom');
      this.uRadius = gl.getUniformLocation(program, 'u_radius');

      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.enableVertexAttribArray(this.aPos);
      gl.enableVertexAttribArray(this.aColor);
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(this.aColor, 3, gl.FLOAT, false, 20, 8);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);

      this.ok = true;
    } catch (err) {
      this.ok = false;
      this.gl = null;
      // 交给调用方回退到 Canvas 2D
      console.warn('[particle-gl] 初始化失败，改用 Canvas 2D：', err.message);
    }
  }

  resize(cw, ch) {
    if (!this.ok) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const canvas = this.canvas;
    const w = Math.round(cw * dpr);
    const h = Math.round(ch * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  ensureCapacity(n) {
    if (n <= this.capacity) return;
    this.capacity = Math.max(n, 256);
    this.data = new Float32Array(this.capacity * 5);
  }

  /** 类型颜色只在 palette 变化时解析一次 */
  syncColors(engine) {
    if (this.colorCache === engine.colors && this.colorTable) return;
    this.colorCache = engine.colors;
    this.colorTable = engine.colors.map(parseColor);
  }

  /**
   * @param {import('../core/particle-life.js').ParticleLifeEngine} engine
   * @param {{ox:number, oy:number, zoom:number, radius:number}} opts 相机与粒子半径（世界单位）
   */
  draw(engine, opts) {
    if (!this.ok) return;
    const gl = this.gl;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (!cw || !ch) return;

    this.resize(cw, ch);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const n = engine.count;
    this.ensureCapacity(n);
    this.syncColors(engine);

    const data = this.data;
    const table = this.colorTable;
    const x = engine.x;
    const y = engine.y;
    const type = engine.type;

    for (let i = 0; i < n; i++) {
      const c = table[type[i]] || [1, 1, 1];
      const o = i * 5;
      data[o] = x[i];
      data[o + 1] = y[i];
      data[o + 2] = c[0];
      data[o + 3] = c[1];
      data[o + 4] = c[2];
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 5), gl.DYNAMIC_DRAW);

    gl.useProgram(this.program);
    gl.uniform2f(this.uResolution, cw, ch);
    gl.uniform2f(this.uOrigin, opts.ox, opts.oy);
    gl.uniform1f(this.uZoom, opts.zoom);
    gl.uniform1f(this.uRadius, opts.radius);

    gl.drawArrays(gl.POINTS, 0, n);
  }
}
