/* ============================================================
 * Turbo Web —— 页面加速引擎
 * 运行环境：页面主世界（MAIN world），document_start
 *
 * 加速手段（分层）：
 *   1. 虚拟时间轴：劫持 requestAnimationFrame / performance.now
 *      使所有「基于时间戳差值」的 JS 动画（GSAP / three.js /
 *      ScrollTrigger / 自写 rAF 循环）整体提速。
 *   2. 定时器缩放：setTimeout / setInterval 延迟按倍率压缩。
 *   3. Web Animations：document.getAnimations() 统一设置
 *      playbackRate，覆盖 CSS animation / transition / WAAPI。
 *   4. 媒体元素：video / audio 的 playbackRate + 保持音调。
 *   5. 可选：SMIL（SVG 内置动画）、Date.now 劫持、逐帧重复
 *      模式（兼容「每帧固定步进」的老式逐帧动画）。
 * ============================================================ */
(() => {
  'use strict';
  if (window.__turboEngine) return;

  const MAX_MEDIA_RATE = 16;   // 浏览器媒体播放速率上限
  const ANIM_TICK = 200;       // Web Animations 巡检间隔(ms)

  const DEFAULTS = {
    speed: 1,
    enabled: true,
    raf: true,          // 虚拟时间轴
    timers: true,       // setTimeout / setInterval
    animations: true,   // CSS 动画 / 过渡 / WAAPI
    media: true,        // video / audio
    keepPitch: true,    // 变速不变调
    smil: false,        // SVG SMIL
    frameRepeat: false, // 逐帧重复（老式动画兜底）
    dateNow: false      // 劫持 Date.now（影响面大，默认关）
  };

  let s = Object.assign({}, DEFAULTS);

  /* ---------------- 原生引用（先存后劫持） ---------------- */
  const nativeNow = performance.now.bind(performance);
  const nativeRAF = window.requestAnimationFrame.bind(window);
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeDateNow = Date.now.bind(Date);

  /* ---------------- 虚拟时间轴 ---------------- */
  let speed = 1;                        // 当前时间流速
  let anchorReal = nativeNow();         // 真实时间锚点
  let anchorVirtual = anchorReal;       // 虚拟时间锚点
  const dateOffset = nativeDateNow() - anchorReal;

  const toVirtual = (t) => anchorVirtual + (t - anchorReal) * speed;
  const virtualNow = () => toVirtual(nativeNow());

  /** 变速时重置锚点，保证虚拟时间连续、不跳变、不倒退 */
  function setSpeed(next) {
    const r = nativeNow();
    anchorVirtual = toVirtual(r);
    anchorReal = r;
    speed = next;
  }

  const effectiveSpeed = () => (s.enabled ? speed : 1);
  const timeWarpOn = () => s.enabled && s.raf && speed > 0;

  /* ---------------- 1. requestAnimationFrame ---------------- */
  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    if (typeof callback !== 'function') return nativeRAF(callback);
    if (!timeWarpOn()) {
      return nativeRAF((t) => callback(t));
    }
    return nativeRAF((t) => {
      const vt = toVirtual(t);
      if (s.frameRepeat) {
        // 老式「每帧固定步进」动画兜底：同一帧内多次派发
        const times = Math.max(1, Math.min(60, Math.round(speed)));
        for (let i = 0; i < times; i++) callback(vt);
      } else {
        callback(vt);
      }
    });
  };

  /* ---------------- 2. 定时器缩放 ---------------- */
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);

  function scaleDelay(delay) {
    const n = Number(delay);
    if (!Number.isFinite(n) || n <= 0) return delay;      // 0 / undefined 原样
    if (!s.enabled || !s.timers || speed <= 0 || speed === 1) return n;
    return n / speed;
  }

  window.setTimeout = function setTimeout(handler, delay, ...args) {
    return nativeSetTimeout(handler, scaleDelay(delay), ...args);
  };

  /* setInterval 采用链式调度：倍率变化后，已在运行的间隔也能立即跟随 */
  let intervalSeq = 0;
  const customIntervals = new Map();   // 负数 id → 条目，与原生 id 空间隔离

  function intervalRate() {
    if (!s.enabled || !s.timers || speed <= 0) return 1;
    return speed;
  }

  window.setInterval = function setInterval(handler, delay, ...args) {
    const base = Number(delay);
    if (typeof handler !== 'function' || !Number.isFinite(base) || base <= 0) {
      return nativeSetInterval(handler, delay, ...args);
    }

    const id = --intervalSeq;
    const entry = { cancelled: false, timer: null, handler, base, args };
    customIntervals.set(id, entry);

    const schedule = () => {
      if (entry.cancelled) return;
      const d = Math.max(1, entry.base / intervalRate());
      entry.timer = nativeSetTimeout(() => {
        if (entry.cancelled) return;
        try {
          entry.handler.apply(window, entry.args);
        } finally {
          // 与原生行为一致：回调抛错不终止后续循环
          schedule();
        }
      }, d);
    };

    schedule();
    return id;
  };

  window.clearInterval = function clearInterval(id) {
    const entry = customIntervals.get(id);
    if (entry) {
      entry.cancelled = true;
      if (entry.timer != null) nativeClearTimeout(entry.timer);
      customIntervals.delete(id);
      return;
    }
    return nativeClearInterval(id);
  };

  window.clearTimeout = function clearTimeout(id) {
    // 容错：部分页面用 clearTimeout 清理 setInterval 的返回值
    if (customIntervals.has(id)) return window.clearInterval(id);
    return nativeClearTimeout(id);
  };

  /* ---------------- 3. performance.now ---------------- */
  performance.now = function now() {
    return timeWarpOn() ? virtualNow() : nativeNow();
  };

  /* ---------------- 4. Date.now（可选） ---------------- */
  const nativeDateNowFn = Date.now;
  let dateHooked = false;
  function hookDate() {
    if (dateHooked) return;
    dateHooked = true;
    Date.now = function now() {
      if (!timeWarpOn()) return nativeDateNowFn.call(Date);
      return Math.round(virtualNow() + dateOffset);
    };
  }
  function unhookDate() {
    if (!dateHooked) return;
    dateHooked = false;
    Date.now = nativeDateNowFn;
  }

  /* ---------------- 5. Web Animations ---------------- */
  let animationCount = 0;

  function animationsRate() {
    if (!s.enabled || !s.animations) return 1;
    return Math.max(0, speed);
  }

  function tickAnimations() {
    if (!document.getAnimations) return;
    let list;
    try {
      list = document.getAnimations();
    } catch (e) {
      return;
    }
    animationCount = list.length;
    if (!animationCount) return;
    const rate = animationsRate();
    for (let i = 0; i < animationCount; i++) {
      const anim = list[i];
      try {
        if (anim.playbackRate !== rate) anim.playbackRate = rate;
      } catch (e) { /* 某些动画不可写，忽略 */ }
    }
  }

  /* ---------------- 6. 媒体元素 ---------------- */
  function mediaRate() {
    if (!s.enabled || !s.media) return 1;
    return Math.max(0, Math.min(speed, MAX_MEDIA_RATE));
  }

  function tickMedia() {
    const rate = mediaRate();
    let nodes;
    try {
      nodes = document.querySelectorAll('video, audio');
    } catch (e) {
      return;
    }
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
      } catch (e) { /* 忽略被 DRM/站点锁定的媒体 */ }
    }
  }

  /* ---------------- 7. SVG SMIL（可选） ---------------- */
  const SMIL_STEP = 50;
  function tickSMIL() {
    if (!s.enabled || !s.smil || speed === 1) return;
    const delta = (SMIL_STEP / 1000) * (speed - 1);
    let svgs;
    try {
      svgs = document.querySelectorAll('svg');
    } catch (e) {
      return;
    }
    for (let i = 0; i < svgs.length; i++) {
      const svg = svgs[i];
      if (typeof svg.getCurrentTime !== 'function') continue;
      try {
        const t = svg.getCurrentTime();
        if (t > 0) svg.setCurrentTime(t + delta);
      } catch (e) { /* 无 SMIL 时忽略 */ }
    }
  }

  /* ---------------- 巡检调度 ---------------- */
  function applyAll() {
    tickAnimations();
    tickMedia();
  }

  // 用原生定时器，避免被自身劫持逻辑影响
  nativeSetInterval(applyAll, ANIM_TICK);

  nativeSetInterval(tickSMIL, SMIL_STEP);

  // 页面新插入节点 / 动画启停时立即补齐
  let pending = null;
  function scheduleApply() {
    if (pending) return;
    pending = nativeSetTimeout(() => {
      pending = null;
      applyAll();
    }, 0);
  }

  try {
    const mo = new MutationObserver(scheduleApply);
    const attach = () => {
      try {
        mo.observe(document.documentElement || document, {
          childList: true, subtree: true, attributes: true,
          attributeFilter: ['class', 'style']
        });
      } catch (e) { /* document_start 阶段 documentElement 可能为空 */ }
    };
    if (document.documentElement) attach();
    else document.addEventListener('readystatechange', attach, { once: true });
  } catch (e) { /* 忽略 */ }

  document.addEventListener('animationstart', scheduleApply, true);
  document.addEventListener('transitionstart', scheduleApply, true);
  document.addEventListener('play', scheduleApply, true);

  /* ---------------- 应用配置 ---------------- */
  function apply(next) {
    s = Object.assign({}, DEFAULTS, next || {});

    const target = s.enabled ? Math.max(0, Number(s.speed) || 1) : 1;
    if (target !== speed) setSpeed(target);

    if (s.dateNow) hookDate();
    else unhookDate();

    // 关闭对应能力时，把已改过的动画 / 媒体恢复原速
    if (!s.animations || !s.enabled) restoreAnimations();
    if (!s.media || !s.enabled) restoreMedia();

    applyAll();
    applyBadgeLocal();
  }

  function restoreAnimations() {
    if (!document.getAnimations) return;
    let list;
    try { list = document.getAnimations(); } catch (e) { return; }
    for (let i = 0; i < list.length; i++) {
      try {
        if (list[i].playbackRate !== 1) list[i].playbackRate = 1;
      } catch (e) { /* 忽略 */ }
    }
  }

  function restoreMedia() {
    let nodes;
    try { nodes = document.querySelectorAll('video, audio'); } catch (e) { return; }
    for (let i = 0; i < nodes.length; i++) {
      try {
        if (Math.abs((nodes[i].playbackRate || 1) - 1) > 0.001) nodes[i].playbackRate = 1;
      } catch (e) { /* 忽略 */ }
    }
  }

  /* ---------------- 与隔离世界通信 ---------------- */
  function applyBadgeLocal() {
    try {
      window.dispatchEvent(new CustomEvent('__turbo:state', {
        detail: { speed: s.speed, enabled: s.enabled, effective: effectiveSpeed() }
      }));
    } catch (e) { /* 忽略 */ }
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data || data.__turbo !== true) return;
    if (data.type === 'apply') apply(data.settings);
  }, false);

  /* ---------------- 启动：先用同步缓存立即生效 ---------------- */
  try {
    const raw = window.localStorage.getItem('__turboCache');
    if (raw) apply(JSON.parse(raw));
  } catch (e) { /* 沙箱 iframe / 禁用存储的页面，忽略 */ }

  window.__turboEngine = {
    apply,
    get speed() { return speed; },
    get settings() { return s; },
    get animationCount() { return animationCount; }
  };

  /* ---------------- 跨世界就绪标记 ----------------
   * 隔离世界读不到主世界的 window.__turboEngine（全局变量不共享），
   * 但 DOM 是共享的 —— 用 data 属性当作"引擎已启动"的信号，
   * 供桥接层判断是否注入成功、是否需要走兜底路径。 */
  function markReady(tries) {
    try {
      const el = document.documentElement;
      if (el) {
        el.setAttribute('data-turbo-ready', '1');
        return;
      }
    } catch (e) { return; }
    if (tries > 0) nativeSetTimeout(() => markReady(tries - 1), 20);
  }
  markReady(50);

  applyBadgeLocal();
})();
