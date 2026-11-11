/**
 * 粒子物理线程。
 *
 * 主线程只负责渲染，物理全部在这里跑；两边通过可转移缓冲乒乓传数据，
 * 稳态下每帧零拷贝、零分配。
 *
 * 协议：
 *   主 → worker  {type:'init'|'reset'|'options'|'spawn'|'attract'|'randomizeAttract'|'frame'}
 *   worker → 主  {type:'ready'|'state'|'matrix'|'frame'}
 */
import { ParticleLifeEngine } from '../core/particle-life.js';

let engine = null;

// 输出缓冲：发出去就被转移（detach），主线程用完再传回来复用
let xOut = null;
let yOut = null;
let typeOut = null;

function allocOutputs() {
  const n = engine.count;
  xOut = new Float32Array(n);
  yOut = new Float32Array(n);
  typeOut = new Uint8Array(n);
}

function snapshot() {
  return {
    count: engine.count,
    nTypes: engine.nTypes,
    colors: engine.colors,
    width: engine.width,
    height: engine.height,
    infinite: engine.infinite,
    wrap: engine.wrap,
    steps: engine.steps,
    matrix: Array.from(engine.attract),
  };
}

function postState() {
  self.postMessage({ type: 'state', ...snapshot() });
}

self.onmessage = (event) => {
  const msg = event.data;

  switch (msg.type) {
    case 'init': {
      engine = new ParticleLifeEngine(msg.width, msg.height, {
        preset: msg.preset,
        count: msg.count,
        wrap: msg.wrap,
        infinite: msg.infinite,
        seed: msg.seed,
      });
      allocOutputs();
      postState();
      break;
    }

    case 'reset': {
      if (!engine) break;
      engine.reset();
      allocOutputs();
      postState();
      break;
    }

    case 'resetCounters': {
      if (!engine) break;
      engine.resetCounters();
      break;
    }

    case 'options': {
      if (!engine) break;
      engine.setOptions(msg.options || {});
      allocOutputs();
      postState();
      break;
    }

    case 'spawn': {
      if (!engine) break;
      const before = engine.count;
      engine.spawn(msg.x, msg.y, msg.amount);
      if (engine.count !== before) allocOutputs();
      break;
    }

    case 'attract': {
      if (!engine) break;
      engine.setAttract(msg.i, msg.j, msg.value);
      break;
    }

    case 'randomizeAttract': {
      if (!engine) break;
      engine.randomizeAttract();
      self.postMessage({ type: 'matrix', matrix: Array.from(engine.attract) });
      break;
    }

    case 'frame': {
      if (!engine) break;

      // 主线程把上一帧的缓冲传回来了，直接复用
      if (msg.x) xOut = new Float32Array(msg.x);
      if (msg.y) yOut = new Float32Array(msg.y);
      if (msg.types) typeOut = new Uint8Array(msg.types);
      if (!xOut || xOut.length !== engine.count) allocOutputs();

      const wanted = Math.max(1, msg.steps | 0);
      const budget = msg.budget > 0 ? msg.budget : 10;
      const start = performance.now();
      let ran = 0;
      // 时间预算：宁可少走几步，也不要让物理线程堵住渲染
      while (ran < wanted && (ran === 0 || performance.now() - start < budget)) {
        engine.step();
        ran++;
      }

      const n = engine.count;
      const x = engine.x;
      const y = engine.y;
      const type = engine.type;
      for (let i = 0; i < n; i++) {
        xOut[i] = x[i];
        yOut[i] = y[i];
        typeOut[i] = type[i];
      }

      self.postMessage(
        {
          type: 'frame',
          x: xOut.buffer,
          y: yOut.buffer,
          types: typeOut.buffer,
          ran,
          steps: engine.steps,
          count: n,
        },
        [xOut.buffer, yOut.buffer, typeOut.buffer],
      );

      // 已经转移给主线程，这里必须置空
      xOut = null;
      yOut = null;
      typeOut = null;
      break;
    }

    default:
      break;
  }
};
