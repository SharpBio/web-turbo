/* ============================================================
 * Turbo Web —— 桥接层（隔离世界 ISOLATED world）
 *
 * 职责：
 *   - 读取 chrome.storage 中的全局 / 站点级配置
 *   - 通过 window.postMessage 把配置交给主世界的加速引擎
 *   - 同步写入 localStorage 缓存（刷新时零延迟生效）
 *   - 向后台上报徽标状态与活跃标签页
 *   - 接收后台转发的快捷键指令并写回存储
 * ============================================================ */
(() => {
  'use strict';
  if (window.__turboBridge) return;
  window.__turboBridge = true;

  const T = globalThis.TurboShared;
  const { KEY, CACHE_KEY, normalize, resolve, clampSpeed, nextStep, label } = T;

  let site = '';
  try {
    site = (location.origin && location.origin !== 'null')
      ? location.origin
      : (location.hostname || '');
  } catch (e) { site = ''; }

  const isTopFrame = (() => {
    try { return window.top === window; } catch (e) { return false; }
  })();

  /* ============================================================
   * 主世界引擎注入
   *
   * 为什么不用 manifest 的 world: "MAIN"：
   *   该字段是 Chrome 111 才支持的。狐猴 / Kiwi 等手机浏览器的
   *   内核停留在 Chromium 107，遇到不认识的键会直接判定
   *   「此扩展程序可能已损坏」并拒绝加载。改用「隔离世界插入
   *   <script> 标签」的通用办法，Chrome 88（MV3 起点）起全部可用。
   *
   * 实测结论（Edge/Chromium 140 + 服务端下发 script-src 'self'）：
   *   页面的 CSP 不会拦 chrome-extension:// 资源 —— 浏览器控制台里
   *   只有页面自己的 data: 媒体被拦，扩展脚本零违规。所以外链注入
   *   在绝大多数站点上都是通的，代价只是「比 world:MAIN 晚几十毫秒」。
   *
   * 三级保障（触发条件从「确定」到「保守」）：
   *   1. 外链脚本注入主世界 —— 全功能，覆盖绝大多数场景
   *   2. 外链触发 error 事件、或 1.5s 仍未就绪 → 换内联注入
   *   3. 3.5s 仍未就绪 → 启动隔离世界降级引擎（只加速 CSS 动画 /
   *      WAAPI / 视频音频），并持续观察，主世界一旦打通立刻升回全功能
   *
   * 时间阈值放宽到秒级是为了迁就手机：低端机上脚本就绪可能就是慢，
   * 过早降级会把「JS 时间轴 + 定时器」这两项能力白白丢掉。
   * ============================================================ */
  const ENGINE_FILE = 'src/inject.js';
  const READY_ATTR = 'data-turbo-ready';
  const BOOT_ATTR = 'data-turbo-boot';

  let engineUp = false;
  let mode = 'main';        // main = 主世界全功能 | dom = 隔离世界降级

  function isEngineReady() {
    if (engineUp) return true;
    try {
      const el = document.documentElement;
      if (el && el.hasAttribute(READY_ATTR)) { engineUp = true; return true; }
    } catch (e) { /* 忽略 */ }
    return false;
  }

  /** 记录注入路径，供排查；inline 一旦成功就不再覆盖 */
  function markBoot(path) {
    try {
      const el = document.documentElement;
      if (el && el.getAttribute(BOOT_ATTR) !== 'inline') el.setAttribute(BOOT_ATTR, path);
    } catch (e) { /* 忽略 */ }
  }

  function injectExternal(url) {
    const host = document.head || document.documentElement;
    if (!host) return false;
    const s = document.createElement('script');
    s.src = url;
    s.async = false;
    s.charset = 'utf-8';
    s.addEventListener('load', () => {
      if (s.parentNode) s.parentNode.removeChild(s);
    });
    // 加载失败是「确定信号」，比盲等超时精准得多
    s.addEventListener('error', () => {
      if (s.parentNode) s.parentNode.removeChild(s);
      if (!isEngineReady()) tryInline();
    });
    host.appendChild(s);
    markBoot('external');
    return true;
  }

  function injectInline(code) {
    const host = document.head || document.documentElement;
    if (!host) return false;
    const s = document.createElement('script');
    s.textContent = code;
    host.appendChild(s);
    if (s.parentNode) s.parentNode.removeChild(s);
    markBoot('inline');
    return true;
  }

  /** 降级到隔离世界的纯 DOM 加速 */
  function useFallback() {
    if (mode === 'dom') return;
    mode = 'dom';
    const F = window.__turboFallback;
    if (F) {
      F.start();
      if (current) F.apply(current);
    }
    const Fl = window.__turboFloating;
    if (Fl && typeof Fl.setMode === 'function') Fl.setMode('dom');
  }

  function onEngineReady() {
    if (mode === 'dom') {
      const F = window.__turboFallback;
      if (F) F.stop();
      mode = 'main';
      const Fl = window.__turboFloating;
      if (Fl && typeof Fl.setMode === 'function') Fl.setMode('main');
    }
    if (current) push(current);
  }

  /** 降级之后仍持续观察：主世界一旦打通就升回全功能 */
  function watchUpgrade() {
    let tries = 0;
    const timer = setInterval(() => {
      if (isEngineReady()) {
        clearInterval(timer);
        onEngineReady();
      } else if (++tries > 24) {   // 观察 12 秒后放弃，不再空转
        clearInterval(timer);
      }
    }, 500);
  }

  /** 第二级兜底：向后台取源码，内联注入主世界 */
  function tryInline() {
    try {
      chrome.runtime.sendMessage({ type: 'turbo:source', file: ENGINE_FILE }, (res) => {
        if (chrome.runtime.lastError || !res || !res.code) return;
        injectInline(res.code);
        setTimeout(() => {
          if (isEngineReady()) onEngineReady();
          else markBoot('blocked');
        }, 80);
      });
    } catch (e) { markBoot('blocked'); }
  }

  function bootEngine(retry) {
    if (isEngineReady()) { onEngineReady(); return; }

    if (!injectExternal(chrome.runtime.getURL(ENGINE_FILE))) {
      // 文档骨架尚未生成（document_start 阶段），稍后重试
      if (retry > 0) setTimeout(() => bootEngine(retry - 1), 20);
      return;
    }

    // 外链脚本通常几十毫秒内就绪
    setTimeout(() => { if (isEngineReady()) onEngineReady(); }, 60);

    setTimeout(() => { if (!isEngineReady()) tryInline(); }, 1500);

    // 最后兜底：切到隔离世界降级引擎，但仍留一条升级通道
    setTimeout(() => {
      if (isEngineReady()) { onEngineReady(); return; }
      markBoot('blocked');
      useFallback();
      watchUpgrade();
    }, 3500);
  }

  bootEngine(50);

  /* ---------------- 下发到主世界 ---------------- */
  let current = null;
  let floatingRetry = false;

  function push(settings) {
    current = settings;

    try {
      window.postMessage({ __turbo: true, type: 'apply', settings }, '*');
    } catch (e) { /* 忽略 */ }

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
    } catch (e) { /* 隐私模式 / 沙箱 iframe，忽略 */ }

    // 降级模式下主世界收不到 postMessage，改喂给隔离世界的引擎
    if (mode === 'dom' && window.__turboFallback) {
      window.__turboFallback.apply(settings);
    }

    if (isTopFrame) {
      safeSend({
        type: 'turbo:badge',
        speed: settings.speed,
        enabled: settings.enabled
      });
      syncFloating(settings);
    }
  }

  /* ---------------- 页面内悬浮控制器 ---------------- */
  function syncFloating(settings) {
    const F = window.__turboFloating;
    if (!F) return;

    if (!settings.floating) {
      F.destroy();
      return;
    }

    const mounted = F.mount(settings, applyPatch);
    if (mounted && typeof F.setMode === 'function') F.setMode(mode);

    if (mounted) return;

    // 文档还没准备好，等 DOM 就绪再补挂一次
    if (!floatingRetry) {
      floatingRetry = true;
      document.addEventListener('DOMContentLoaded', () => {
        floatingRetry = false;
        if (current && current.floating && F.mount(current, applyPatch) && typeof F.setMode === 'function') {
          F.setMode(mode);
        }
      }, { once: true });
    }
  }

  /** 把改动写回存储（站点记忆开启时写当前站点） */
  function writeInto(store, patch) {
    const globalOnly = { perSite: true, floating: true };
    const toSite = {};
    const toGlobal = {};
    let touchedSite = false;

    Object.keys(patch).forEach((k) => {
      if (globalOnly[k]) toGlobal[k] = patch[k];
      else if (store.global.perSite && site) { toSite[k] = patch[k]; touchedSite = true; }
      else toGlobal[k] = patch[k];
    });

    Object.assign(store.global, toGlobal);
    if (touchedSite) store.sites[site] = Object.assign({}, store.sites[site], toSite);
    return store;
  }

  function applyPatch(patch) {
    chrome.storage.local.get(KEY, (res) => {
      const store = writeInto(normalize(res[KEY]), patch);
      chrome.storage.local.set({ [KEY]: store });
    });
  }

  function applyStore(raw) {
    push(resolve(normalize(raw), site));
  }

  /* ---------------- 与后台通信 ---------------- */
  function safeSend(msg) {
    try {
      const p = chrome.runtime.sendMessage(msg);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* 扩展重载期间会抛错，忽略 */ }
  }

  function reportActive() {
    if (!isTopFrame) return;
    try {
      if (document.visibilityState !== 'visible') return;
      safeSend({ type: 'turbo:active', site });
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 页面内浮层提示（快捷键反馈） ---------------- */
  let toastRoot = null;
  let toastBox = null;
  let toastText = null;
  let toastTimer = null;

  function ensureToast() {
    if (toastBox) return true;
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;left:50%;top:22px;transform:translateX(-50%);' +
      'z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : null;
    if (!root) return false;
    root.innerHTML =
      '<style>' +
      '.box{display:flex;align-items:center;gap:9px;padding:11px 18px;border-radius:999px;' +
      'background:rgba(15,18,30,.94);color:#fff;border:1px solid rgba(255,255,255,.14);' +
      'font:600 15px/1 -apple-system,"Segoe UI",system-ui,sans-serif;white-space:nowrap;' +
      'box-shadow:0 10px 32px rgba(0,0,0,.42);backdrop-filter:blur(12px);' +
      'opacity:0;transform:translateY(-10px);transition:opacity .16s ease,transform .16s ease}' +
      '.box.on{opacity:1;transform:translateY(0)}' +
      '.dot{width:9px;height:9px;border-radius:50%;background:#f43f5e;box-shadow:0 0 10px #f43f5e}' +
      '.box.off .dot{background:#64748b;box-shadow:none}' +
      '.txt{letter-spacing:.2px}' +
      '</style>' +
      '<div class="box" id="box"><span class="dot"></span><span class="txt" id="txt"></span></div>';
    const mount = document.body || document.documentElement;
    if (!mount) return false;
    mount.appendChild(host);
    toastRoot = root;
    toastBox = root.getElementById('box');
    toastText = root.getElementById('txt');
    return true;
  }

  function showToast(settings) {
    if (!isTopFrame) return;
    if (!ensureToast()) return;
    toastText.textContent = settings.enabled
      ? label(settings.speed)
      : '已暂停加速';
    toastBox.classList.toggle('off', !settings.enabled);
    toastBox.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastBox) toastBox.classList.remove('on');
    }, 1200);
  }

  /* ---------------- 快捷键指令 ---------------- */
  function adjust(mode) {
    chrome.storage.local.get(KEY, (res) => {
      const store = normalize(res[KEY]);
      const cur = resolve(store, site);
      let speed = cur.speed;
      let enabled = cur.enabled;

      if (mode === 'up') speed = nextStep(speed, 1);
      else if (mode === 'down') speed = nextStep(speed, -1);
      else if (mode === 'reset') { speed = 1; enabled = true; }
      else if (mode === 'toggle') enabled = !enabled;
      else return;

      speed = clampSpeed(speed);
      writeInto(store, { speed, enabled });
      chrome.storage.local.set({ [KEY]: store });
      showToast({ speed, enabled });
    });
  }

  /* ---------------- 启动与订阅 ---------------- */
  chrome.storage.local.get(KEY, (res) => applyStore(res[KEY]));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    applyStore(changes[KEY].newValue);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'turbo:adjust') adjust(msg.mode);
  });

  document.addEventListener('visibilitychange', reportActive);
  window.addEventListener('focus', reportActive);
  window.addEventListener('pageshow', reportActive);
  reportActive();
})();
