/**
 * 五行流向环。
 *
 * 二维网格只给空间快照，生克关系看不出来。这张图把关系本身画出来：
 *   - 五个节点排成环，节点大小 = 当前占比
 *   - 外圈五条弧 = 相生（木→火→土→金→水→木），线宽 = 本代实际次数
 *   - 内圈五角星 = 相克（木→土→水→火→金→木），虚线，线宽 = 本代被克死的次数
 *
 * 流量为 0 时仍保留最细的线，保证关系结构始终可见。
 */

const TAU = Math.PI * 2;

/** 相克：k 克 ke(k)，与 core/wuxing.js 保持一致 */
const KE = [0, 3, 4, 5, 1, 2];

function drawCurveArrow(ctx, start, control, end, width, color, dashed) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  if (dashed) ctx.setLineDash([3, 3]);

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);

  const angle = Math.atan2(end.y - control.y, end.x - control.x);
  const size = 4 + width * 1.3;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - Math.cos(angle - 0.42) * size, end.y - Math.sin(angle - 0.42) * size);
  ctx.lineTo(end.x - Math.cos(angle + 0.42) * size, end.y - Math.sin(angle + 0.42) * size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{totals: Int32Array, flows: {bornFrom: Uint32Array, advanced: Uint32Array, killedBy: Uint32Array}, palette: string[], names: string[]}} options
 */
export function drawRing(canvas, options) {
  const { totals, flows, palette, names } = options;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;

  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  // 留出标签的位置：节点半径 + 10px 文字外距，否则顶部的「木」会被画布切掉
  const radius = Math.min(w, h) / 2 - 34;

  // 节点位置
  const nodes = [];
  for (let i = 0; i < 5; i++) {
    const angle = -Math.PI / 2 + (i * TAU) / 5;
    nodes.push({
      index: i,
      state: i + 1,
      angle,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }

  const alive = Math.max(1, totals[1] + totals[2] + totals[3] + totals[4] + totals[5]);

  // 流量归一化：生与克各自用各自的最大值。
  // 两者数量级差很多（生的次数通常远大于克），共用一把尺子会把克压成一条看不见的线。
  let maxGen = 1;
  let maxKe = 1;
  for (let s = 1; s <= 5; s++) {
    maxGen = Math.max(maxGen, flows.advanced[s] + flows.bornFrom[s]);
    maxKe = Math.max(maxKe, flows.killedBy[s]);
  }
  const widthOf = (value, max) =>
    value <= 0 ? 0.8 : 1 + 3.4 * Math.pow(value / max, 0.6);

  // 底圈，给出环形结构
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 相克：五角星，先画（压在下层）
  for (let s = 1; s <= 5; s++) {
    const from = nodes[s - 1];
    const to = nodes[KE[s] - 1];
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    const start = { x: from.x + ux * 9, y: from.y + uy * 9 };
    const end = { x: to.x - ux * 11, y: to.y - uy * 11 };
    const value = flows.killedBy[s];
    const color = `rgba(148, 163, 184, ${0.25 + 0.45 * (value / maxKe)})`;

    drawCurveArrow(ctx, start, { x: mx, y: my }, end, widthOf(value, maxKe), color, true);
  }

  // 相生：外圈弧，向外鼓出
  for (let s = 1; s <= 5; s++) {
    const from = nodes[s - 1];
    const to = nodes[s % 5];
    const midAngle = from.angle + TAU / 10;
    const control = {
      x: cx + Math.cos(midAngle) * radius * 1.34,
      y: cy + Math.sin(midAngle) * radius * 1.34,
    };

    const ux = control.x - from.x;
    const uy = control.y - from.y;
    const ul = Math.hypot(ux, uy) || 1;
    const start = { x: from.x + (ux / ul) * 10, y: from.y + (uy / ul) * 10 };

    const vx = to.x - control.x;
    const vy = to.y - control.y;
    const vl = Math.hypot(vx, vy) || 1;
    const end = { x: to.x - (vx / vl) * 12, y: to.y - (vy / vl) * 12 };

    const value = flows.advanced[s] + flows.bornFrom[s];
    const alpha = 0.25 + 0.6 * (value / maxGen);

    drawCurveArrow(ctx, start, control, end, widthOf(value, maxGen), hexToRgba(palette[s], alpha), false);
  }

  // 节点与标签
  for (const node of nodes) {
    const share = totals[node.state] / alive;
    const r = 7 + 10 * Math.sqrt(share);

    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, TAU);
    ctx.fillStyle = palette[node.state];
    ctx.fill();
    ctx.strokeStyle = 'rgba(5, 8, 12, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const labelR = radius + r + 10;
    const lx = cx + Math.cos(node.angle) * labelR;
    const ly = cy + Math.sin(node.angle) * labelR;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(names[node.state], lx, ly);
  }
}

/** #rrggbb → rgba()，用来给线条调透明度 */
function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}
