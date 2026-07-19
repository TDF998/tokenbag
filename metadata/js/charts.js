/* ============================================================
   charts.js — 轻量手绘图表（无第三方依赖）
   目前提供：北向资金近 N 日净买入折线 + 面积填充
   支持 devicePixelRatio 高清渲染与容器自适应。
   ============================================================ */

window.Charts = (function () {
  function setupHiDPI(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  /* 北向资金折线 */
  function drawNorthLine(canvas, series) {
    if (!canvas || !Array.isArray(series) || series.length === 0) return;
    const { ctx, w, h } = setupHiDPI(canvas);
    ctx.clearRect(0, 0, w, h);

    const padL = 38, padR = 10, padT = 12, padB = 18;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const min = Math.min(0, ...series);
    const max = Math.max(0, ...series);
    const range = max - min || 1;
    const xStep = plotW / (series.length - 1);
    const yOf = (v) => padT + plotH - ((v - min) / range) * plotH;

    // 网格 + Y 轴标签
    ctx.font = "10px monospace";
    ctx.textBaseline = "middle";
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = min + (range * i) / ticks;
      const y = yOf(v);
      ctx.strokeStyle = "rgba(120,150,200,0.10)";
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(150,170,200,0.55)";
      ctx.textAlign = "right";
      ctx.fillText(v.toFixed(0), padL - 6, y);
    }

    // 零线（加粗）
    const y0 = yOf(0);
    ctx.strokeStyle = "rgba(200,210,230,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y0);
    ctx.lineTo(w - padR, y0);
    ctx.stroke();

    // 面积填充
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, "rgba(240,185,11,0.34)");
    grad.addColorStop(1, "rgba(240,185,11,0.02)");
    ctx.beginPath();
    ctx.moveTo(padL, y0);
    series.forEach((v, i) => ctx.lineTo(padL + i * xStep, yOf(v)));
    ctx.lineTo(w - padR, y0);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 折线
    ctx.beginPath();
    series.forEach((v, i) => {
      const x = padL + i * xStep;
      const y = yOf(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#f0b90b";
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.stroke();

    // 末点高亮
    const lastX = padL + (series.length - 1) * xStep;
    const lastY = yOf(series[series.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = "#f0b90b";
    ctx.fill();
    ctx.strokeStyle = "rgba(240,185,11,0.4)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 5.5, 0, Math.PI * 2);
    ctx.stroke();

    // X 轴起止标注
    ctx.fillStyle = "rgba(150,170,200,0.55)";
    ctx.textAlign = "left";
    ctx.fillText("20日前", padL, h - 8);
    ctx.textAlign = "right";
    ctx.fillText("今日", w - padR, h - 8);
  }

  return { drawNorthLine };
})();
