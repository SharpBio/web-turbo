/* ============================================================
 * Turbo Web —— 降级引擎（隔离世界 ISOLATED world，纯 DOM 层）
 *
 * 什么时候会走到这里：
 *   站点设了严格 CSP（如 script-src 'self'），把 chrome-extension://
 *   的外链脚本和内联脚本一起拦了，主世界引擎进不去。
 *   world:"MAIN" 能无视 CSP，但那需要 Chrome 111；为了照顾
 *   手机浏览器（狐猴等 Chromium 107 内核）不能用，于是准备这一层。
 *
 * 为什么它仍然有效：
 *   两个 JS 世界的全局变量不共享，但 **DOM 是同一个**。
 *   所以下面这些照样能加速，且不受任何 CSP 限制：
 *     - CSS animation / transition / element.animate()（WAAPI）
 *     - <video> / <audio> 的 playbackRate
 *     - SVG SMIL 的 setCurrentTime
 *
 * 做不到什么：
 *     - requestAnimationFrame / performance.now 的虚拟时间轴
 *     - setTimeout / setInterval 的延迟缩放
 *   这两类必须改写页面自己的全局函数，只能在主世界完成。
 * ============================================================ */
(() => {
  'use strict';
  if (window.__turboFallback) return;

  const MAX_MEDIA_RATE = 16;
  const TICK = 200;        // 动画巡检间隔(ms)
  const SMIL_STEP = 50;    // SMIL 步进间隔(ms)

  const DEFAULTS = {
    speed: 1, enabled: true, raf: true, timers: true,
    animations: true, media: true, keepPitch: true,
    smil: false, frameRepeat: false, dateNow: false
  };

  let s = Object.assign({}, DEFAULTS);
  let running = false;
  let animTimer = null;
  let smilTimer = null;
  let mo = null;

  /* ---------------- CSS 动画 / 过渡 / WAAPI ---------------- */
  function tickAnimations() {
    if (!document.getAnimations) return;
    let list;
    try { list = document.getAnimations(); } catch (e) { return; }

    const rate = (s.enabled && s.animations) ? Math.max(0, s.speed) : 1;
    for (let i = 0; i < list.length; i++) {
      try {
        if (list[i].playbackRate !== rate) list[i].playbackRate = rate;
      } catch (e) { /* 个别动画不可写，忽略 */ }
    }
  }

  /* ---------------- 媒体元素 ---------------- */
  function tickMedia() {
    const rate = (s.enabled && s.media)
      ? Math.max(0, Math.min(s.speed, MAX_MEDIA_RATE))
      : 1;
    let nodes;
    try { nodes = document.querySelectorAll('video, audio'); } catch (e) { return; }

    for (let i = 0; i < nodes.length; i++) {
      const m = nodes[i];
      try {
        if (rate <= 0) {
          if (!m.paused) m.pause();
        } else if (Math.abs((m.playbackRate || 1) - rate) > 0.001) {
          m.playbackRate = rate;
        }
        if ('preservesPitch' in m) m.preservesPitch = !!s.keepPitch;
        if ('mozPreservesPitch' in m) m.mozPreservesPitch = !!s.keepPitch;
        if ('webkitPreservesPitch' in m) m.webkitPreservesPitch = !!s.keepPitch;
      } catch (e) { /* DRM / 站点锁定的媒体，忽略 */ }
    }
  }

  /* ---------------- SVG SMIL ---------------- */
  function tickSMIL() {
    if (!s.enabled || !s.smil || s.speed === 1) return;
    const delta = (SMIL_STEP / 1000) * (s.speed - 1);
    let svgs;
    try { svgs = document.querySelectorAll('svg'); } catch (e) { return; }
    for (let i = 0; i < svgs.length; i++) {
      const svg = svgs[i];
      if (typeof svg.getCurrentTime !== 'function') continue;
      try {
        const t = svg.getCurrentTime();
        if (t > 0) svg.setCurrentTime(t + delta);
      } catch (e) { /* 无 SMIL 时忽略 */ }
    }
  }

  function applyAll() {
    tickAnimations();
    tickMedia();
  }

  function restoreAll() {
    const keep = s;
    s = Object.assign({}, keep, { enabled: false });
    applyAll();
    s = keep;
  }

  /* ---------------- 生命周期 ---------------- */
  function start() {
    if (running) return;
    running = true;
    animTimer = setInterval(applyAll, TICK);
    smilTimer = setInterval(tickSMIL, SMIL_STEP);

    // 新节点插入 / class 切换触发动画时立即补齐
    try {
      let pending = null;
      const schedule = () => {
        if (pending) return;
        pending = setTimeout(() => { pending = null; applyAll(); }, 0);
      };
      mo = new MutationObserver(schedule);
      const target = document.documentElement || document;
      mo.observe(target, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style']
      });
      document.addEventListener('animationstart', schedule, true);
      document.addEventListener('transitionstart', schedule, true);
      document.addEventListener('play', schedule, true);
    } catch (e) { /* 忽略 */ }

    applyAll();
  }

  function stop() {
    if (!running) return;
    running = false;
    if (animTimer) clearInterval(animTimer);
    if (smilTimer) clearInterval(smilTimer);
    animTimer = smilTimer = null;
    if (mo) { try { mo.disconnect(); } catch (e) { /* 忽略 */ } mo = null; }
    restoreAll();
  }

  function apply(next) {
    s = Object.assign({}, DEFAULTS, next || {});
    if (running) applyAll();
  }

  window.__turboFallback = {
    apply, start, stop,
    get running() { return running; },
    get settings() { return s; }
  };
})();
