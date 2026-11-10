/**
 * 五态时间曲线：木火土金水各一条线，横轴是最近若干代。
 *
 * 二维网格看不出「周期」和「谁领先谁滞后」，把每代各状态的数量画成曲线就看出来了：
 * 五条线保持恒定相位差 = 循环振荡；一条线压死其余 = 单态独大；全都贴地 = 灭绝。
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number[][]} series 五条曲线，长度必须一致，索引 0 对应木
 * @param {string[]} palette 颜色表，索引与状态值对齐（1..5）
 */
export function drawSeries(canvas, series, palette) {
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

  const length = series[0]?.length ?? 0;
  if (length < 2) return;

  let max = 1;
  for (const line of series) for (const value of line) if (value > max) max = value;

  const stepX = w / (length - 1);
  const scaleY = (value) => h - 3 - (value / max) * (h - 6);

  // 零线
  ctx.beginPath();
  ctx.moveTo(0, h - 1.5);
  ctx.lineTo(w, h - 1.5);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();

  for (let s = 0; s < 5; s++) {
    const line = series[s];
    ctx.beginPath();
    line.forEach((value, i) => {
      const x = i * stepX;
      const y = scaleY(value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = palette[s + 1];
    ctx.lineWidth = 1.3;
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
