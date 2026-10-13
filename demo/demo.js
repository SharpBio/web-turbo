/* ============================================================
 * Turbo Web —— 演示页控制与动画
 * 所有动画都交由页面自身的 API 驱动，从而如实反映加速效果
 * ============================================================ */
(() => {
  'use strict';

  const T = globalThis.TurboShared;
  const { MIN_SPEED, MAX_SPEED, clampSpeed, label } = T;

  const LN_RATIO = Math.log(MAX_SPEED / MIN_SPEED);
  const speedToPos = (v) => Math.round(1000 * Math.log(clampSpeed(v) / MIN_SPEED) / LN_RATIO);
  const posToSpeed = (p) => MIN_SPEED * Math.exp((p / 1000) * LN_RATIO);

  const PRESETS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 8, 16];

  const settings = {
    speed: 1,
    enabled: true,
    raf: true,
    timers: true,
    animations: true,
    media: true,
    keepPitch: true,
    smil: true,
    frameRepeat: false,
    dateNow: false
  };

  const $ = (id) => document.getElementById(id);
  const slider = $('slider');
  const speedVal = $('speedVal');
  const toggleBtn = $('toggle');
  const chipsBox = $('chips');

  let dragging = false;

  function push() {
    window.postMessage({ __turbo: true, type: 'apply', settings: Object.assign({}, settings) }, '*');
    render();
  }

  function render() {
    speedVal.textContent = String(Math.round(settings.speed * 100) / 100);
    if (!dragging) slider.value = String(speedToPos(settings.speed));
    toggleBtn.textContent = settings.enabled ? '暂停加速' : '恢复加速';
    document.querySelectorAll('.chip').forEach((c) => {
      const v = Number(c.dataset.v);
      c.classList.toggle('active', settings.enabled && Math.abs(v - settings.speed) < 1e-6);
    });
  }

  function setSpeed(v) {
    settings.speed = clampSpeed(v);
    settings.enabled = true;
    push();
  }

  /* ---------------- 控制条 ---------------- */
  slider.addEventListener('input', () => {
    dragging = true;
    speedVal.textContent = String(Math.round(posToSpeed(Number(slider.value)) * 100) / 100);
    settings.speed = clampSpeed(posToSpeed(Number(slider.value)));
    settings.enabled = true;
    window.postMessage({ __turbo: true, type: 'apply', settings: Object.assign({}, settings) }, '*');
  });

  slider.addEventListener('change', () => {
    dragging = false;
    push();
  });

  PRESETS.forEach((v) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.v = String(v);
    b.textContent = label(v);
    b.addEventListener('click', () => setSpeed(v));
    chipsBox.appendChild(b);
  });

  toggleBtn.addEventListener('click', () => {
    settings.enabled = !settings.enabled;
    push();
  });

  /* ---------------- CSS transition ---------------- */
  const ball = $('ball');
  $('goBtn').addEventListener('click', () => ball.classList.toggle('right'));

  /* ---------------- Web Animations API ---------------- */
  const waapi = $('waapi');
  waapi.animate(
    [
      { transform: 'rotate(0deg) scale(1)', borderRadius: '16px' },
      { transform: 'rotate(180deg) scale(1.35)', borderRadius: '50%' },
      { transform: 'rotate(360deg) scale(1)', borderRadius: '16px' }
    ],
    { duration: 1600, iterations: Infinity, easing: 'ease-in-out' }
  );

  /* ---------------- setInterval 计数器 ---------------- */
  let ticks = 0;
  const tickEl = $('tick');
  setInterval(() => {
    ticks += 1;
    tickEl.textContent = String(ticks);
  }, 1000);

  /* ---------------- canvas：rAF 物理运动 ---------------- */
  const cv = $('cv');
  const ctx = cv.getContext('2d');
  let W = 0;
  let H = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener('resize', resize);

  const startTime = performance.now();

  function draw() {
    const elapsed = (performance.now() - startTime) / 1000;   // 虚拟秒（会被加速）
    ctx.clearRect(0, 0, W, H);

    // 进度条：3 秒一轮
    const p = (elapsed % 3) / 3;
    const barY = 28;
    const barH = 8;
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    roundRect(14, barY, W - 28, barH, 4);
    ctx.fill();

    const grad = ctx.createLinearGradient(14, 0, W - 14, 0);
    grad.addColorStop(0, '#a78bfa');
    grad.addColorStop(1, '#22d3ee');
    ctx.fillStyle = grad;
    roundRect(14, barY, Math.max(2, (W - 28) * p), barH, 4);
    ctx.fill();

    // 弹跳球：水平往返 + 抛物线
    const cycle = (elapsed % 2.4) / 2.4;
    const x = 24 + (W - 48) * (cycle < 0.5 ? cycle * 2 : (1 - cycle) * 2);
    const hopPhase = (elapsed % 0.6) / 0.6;
    const y = H - 28 - Math.abs(Math.sin(hopPhase * Math.PI)) * 58;

    const glow = ctx.createRadialGradient(x, y, 1, x, y, 30);
    glow.addColorStop(0, 'rgba(103,232,249,0.85)');
    glow.addColorStop(1, 'rgba(103,232,249,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e0f7ff';
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();

    // 地面
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(14, H - 14);
    ctx.lineTo(W - 14, H - 14);
    ctx.stroke();

    // 时间读数
    ctx.fillStyle = 'rgba(200,210,230,0.72)';
    ctx.font = '600 13px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(elapsed.toFixed(1) + ' s', W - 14, 18);
    ctx.textAlign = 'left';

    requestAnimationFrame(draw);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  resize();
  requestAnimationFrame(draw);
  render();
  push();
})();
