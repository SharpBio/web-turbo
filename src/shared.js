/* ============================================================
 * Turbo Web —— 共享常量与纯函数
 * 供 service worker / 隔离世界 content script / popup 复用
 * ============================================================ */
(function (g) {
  'use strict';

  const KEY = 'turboSettings';        // chrome.storage 键
  const CACHE_KEY = '__turboCache';   // 主世界 localStorage 缓存键

  const MIN_SPEED = 0.1;
  const MAX_SPEED = 16;

  // 快捷键 / 预设的档位序列
  const STEPS = [
    0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2,
    2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 16
  ];

  const DEFAULTS = {
    speed: 1,
    enabled: true,
    raf: true,          // 虚拟时间轴（rAF / performance.now）
    timers: true,       // setTimeout / setInterval
    animations: true,   // CSS 动画 / 过渡 / WAAPI
    media: true,        // video / audio 播放速率
    keepPitch: true,    // 变速不变调
    smil: false,        // SVG SMIL
    frameRepeat: false, // 逐帧重复（老式逐帧动画兜底）
    dateNow: false,     // 劫持 Date.now
    perSite: false,     // 按站点分别记忆速度
    floating: true      // 页面内悬浮控制器（手机上用它调速）
  };

  function clampSpeed(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    return Math.min(MAX_SPEED, Math.max(MIN_SPEED, n));
  }

  function nextStep(current, dir) {
    if (dir > 0) {
      for (let i = 0; i < STEPS.length; i++) {
        if (STEPS[i] > current + 1e-6) return STEPS[i];
      }
      return STEPS[STEPS.length - 1];
    }
    for (let i = STEPS.length - 1; i >= 0; i--) {
      if (STEPS[i] < current - 1e-6) return STEPS[i];
    }
    return STEPS[0];
  }

  function normalize(raw) {
    const store = (raw && typeof raw === 'object') ? raw : {};
    store.global = Object.assign({}, DEFAULTS, store.global || {});
    if (!store.sites || typeof store.sites !== 'object') store.sites = {};
    return store;
  }

  /** 合并全局配置与站点覆盖 */
  function resolve(store, site) {
    const g2 = store.global;
    const override = (g2.perSite && site) ? store.sites[site] : null;
    const merged = Object.assign({}, g2, override || {});
    merged.speed = clampSpeed(merged.speed);
    return merged;
  }

  /** 徽标文本（最多 4 字符） */
  function formatSpeed(v) {
    if (v >= 10) return Math.round(v) + 'x';
    const txt = (Math.round(v * 100) / 100).toString();
    const short = txt.length <= 3 ? txt : (Math.round(v * 10) / 10).toString();
    return short + 'x';
  }

  /** 展示用：1 -> "1x"，1.25 -> "1.25x" */
  function label(v) {
    const r = Math.round(v * 100) / 100;
    return (Number.isInteger(r) ? r : parseFloat(r.toFixed(2))) + 'x';
  }

  g.TurboShared = {
    KEY, CACHE_KEY,
    MIN_SPEED, MAX_SPEED, STEPS, DEFAULTS,
    clampSpeed, nextStep, normalize, resolve, formatSpeed, label
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
