/**
 * 主线程这端的 Worker 代理。
 *
 * 对外装成引擎的样子（x / y / type / colors / count / nTypes / setOptions / spawn ...），
 * 这样渲染器和界面代码不用改；实际计算在 worker 里。
 *
 * 数据流：每帧 requestFrame() 把上一帧用完的缓冲传回去，worker 填好再转移回来。
 * 稳态下没有分配、没有拷贝。
 */
export class ParticleWorkerHost {
  constructor(width, height, options = {}) {
    this.isWorker = true;
    this.width = width;
    this.height = height;

    this.x = new Float32Array(0);
    this.y = new Float32Array(0);
    this.type = new Uint8Array(0);
    this.count = 0;
    this.nTypes = 0;
    this.colors = [];
    this.steps = 0;
    this.lastRan = 0;

    this.matrix = null;
    this.ready = false;
    this.awaiting = false;
    this.idle = null; // 上一帧用完、可以还给 worker 的缓冲

    // 界面读这里，字段和本地引擎保持一致
    this.stats = { population: 0, types: 0, births: 0, deaths: 0 };

    this.worker = new Worker(new URL('../workers/particle-worker.js', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event) => this.handle(event.data);
    this.worker.onerror = (event) => {
      console.warn('[particle-worker] 出错，物理停摆：', event.message);
    };

    this.post({
      type: 'init',
      width,
      height,
      preset: options.preset,
      count: options.count,
      wrap: options.wrap,
      infinite: options.infinite,
      seed: options.seed,
    });
  }

  post(msg, transfer) {
    this.worker.postMessage(msg, transfer || []);
  }

  handle(msg) {
    switch (msg.type) {
      case 'state': {
        this.count = msg.count;
        this.nTypes = msg.nTypes;
        this.colors = msg.colors;
        this.width = msg.width;
        this.height = msg.height;
        this.infinite = Boolean(msg.infinite);
        this.steps = msg.steps;
        this.matrix = new Float32Array(msg.matrix);
        this.stats.population = msg.count;
        this.stats.types = msg.nTypes;
        this.ready = true;
        break;
      }
      case 'matrix': {
        this.matrix = new Float32Array(msg.matrix);
        break;
      }
      case 'frame': {
        // 上一帧画完的数组交出去，换成新的
        this.idle = { x: this.x, y: this.y, types: this.type, count: this.count };
        this.x = new Float32Array(msg.x);
        this.y = new Float32Array(msg.y);
        this.type = new Uint8Array(msg.types);
        this.count = msg.count;
        this.steps = msg.steps;
        this.lastRan = msg.ran;
        this.stats.population = msg.count;
        this.awaiting = false;
        break;
      }
      default:
        break;
    }
  }

  /** 请求推进一帧物理；steps 是这一帧想走的步数，budget 是毫秒上限 */
  requestFrame(steps, budget = 10) {
    if (!this.ready || this.awaiting) return;

    const msg = { type: 'frame', steps, budget };
    const transfer = [];
    if (this.idle) {
      msg.x = this.idle.x.buffer;
      msg.y = this.idle.y.buffer;
      msg.types = this.idle.types.buffer;
      transfer.push(msg.x, msg.y, msg.types);
      this.idle = null;
    }

    this.awaiting = true;
    this.post(msg, transfer);
  }

  /* ---------- 以下是与本地引擎对齐的接口 ---------- */

  get generation() {
    return this.steps;
  }

  reset() {
    this.post({ type: 'reset' });
  }

  resetCounters() {
    // 计数器在 worker 里，请它清零；本地先归零，界面不用等一个来回
    this.steps = 0;
    this.post({ type: 'resetCounters' });
  }

  setOptions(options) {
    this.post({ type: 'options', options });
  }

  spawn(wx, wy, amount) {
    this.post({ type: 'spawn', x: wx, y: wy, amount });
  }

  getAttract(i, j) {
    if (!this.matrix) return 0;
    return this.matrix[i * this.nTypes + j];
  }

  setAttract(i, j, value) {
    if (!this.matrix) return;
    const clamped = Math.max(-0.25, Math.min(0.25, value));
    this.matrix[i * this.nTypes + j] = clamped;
    this.post({ type: 'attract', i, j, value: clamped });
    return clamped;
  }

  randomizeAttract() {
    this.post({ type: 'randomizeAttract' });
  }

  dispose() {
    this.worker.terminate();
  }
}
