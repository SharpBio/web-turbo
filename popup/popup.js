/* ============================================================
 * Turbo Web —— 控制面板逻辑
 * ============================================================ */
(() => {
  'use strict';

  const T = globalThis.TurboShared;
  const { KEY, DEFAULTS, MIN_SPEED, MAX_SPEED, STEPS, clampSpeed, normalize, resolve } = T;

  const $ = (id) => document.getElementById(id);

  const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
  const hasTabs = hasChrome && !!chrome.tabs && typeof chrome.tabs.query === 'function';
  const PREVIEW = !hasChrome;

  const PRESETS = [0.5, 1, 1.5, 2, 3, 4, 8, 16];
  const TOGGLE_KEYS = ['raf', 'animations', 'media', 'timers', 'keepPitch',
    'perSite', 'smil', 'frameRepeat', 'dateNow', 'floating'];

  let site = '';
  let store = normalize(null);
  let settings = resolve(store, '');
  let dragging = false;
  let memoryStore = null;   // 预览模式下的内存存储

  /* ---------------- 滑块：对数刻度 ---------------- */
  const LN_RATIO = Math.log(MAX_SPEED / MIN_SPEED);
  const speedToPos = (v) => Math.round(1000 * Math.log(clampSpeed(v) / MIN_SPEED) / LN_RATIO);
  const posToSpeed = (p) => MIN_SPEED * Math.exp((p / 1000) * LN_RATIO);

  function snap(v) {
    for (let i = 0; i < STEPS.length; i++) {
      if (Math.abs(STEPS[i] - v) / STEPS[i] < 0.025) return STEPS[i];
    }
    return Math.round(v * 100) / 100;
  }

  /* ---------------- 存储适配（含预览降级） ---------------- */
  async function loadStore() {
    if (PREVIEW) {
      if (!memoryStore) {
        memoryStore = { global: Object.assign({}, DEFAULTS, { speed: 2 }), sites: {} };
      }
      return memoryStore;
    }
    const res = await chrome.storage.local.get(KEY);
    return normalize(res[KEY]);
  }

  function saveStore(value) {
    if (PREVIEW) {
      memoryStore = value;
      return Promise.resolve();
    }
    return chrome.storage.local.set({ [KEY]: value });
  }

  /* ---------------- 站点信息 ---------------- */
  function originOf(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:') {
        return u.protocol === 'file:' ? 'file://' : u.origin;
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  async function detectSite() {
    if (!hasTabs) {
      site = 'example.com';
      return { url: 'https://example.com', preview: true };
    }
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      site = originOf(tab && tab.url);
      return { url: tab ? tab.url : '', preview: false };
    } catch (e) {
      site = '';
      return { url: '', preview: false };
    }
  }

  const isSiteOverridden = () => !!(settings.perSite && site && store.sites && store.sites[site]);
  const isSiteDisabled = () => !!(settings.perSite && site && store.sites && store.sites[site] &&
    store.sites[site].enabled === false);

  /* ---------------- 写回 ---------------- */
  function commit(patch) {
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
    if (touchedSite) {
      store.sites[site] = Object.assign({}, store.sites[site], toSite);
    }

    settings = resolve(store, site);
    saveStore(store).then(render);
  }

  /* ---------------- 节流提交（滑块拖动） ---------------- */
  let pendingPatch = null;
  let commitTimer = null;

  function commitSoon(patch) {
    pendingPatch = Object.assign(pendingPatch || {}, patch);
    if (commitTimer) return;
    commitTimer = setTimeout(() => {
      commitTimer = null;
      const p = pendingPatch;
      pendingPatch = null;
      if (p) commit(p);
    }, 90);
  }

  function flushNow() {
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = null;
    if (pendingPatch) {
      const p = pendingPatch;
      pendingPatch = null;
      commit(p);
    }
  }

  /* ---------------- 渲染 ---------------- */
  function stateHint() {
    if (!settings.enabled) return { text: '已暂停 · 页面按原始速度运行', cls: 'off' };
    if (settings.speed > 1) return { text: `页面运行速度 ×${settings.speed}`, cls: 'hot' };
    if (settings.speed < 1) return { text: `页面运行速度 ×${settings.speed}（慢放）`, cls: '' };
    return { text: '原始速度', cls: '' };
  }

  function render() {
    settings = resolve(store, site);

    // 主显
    $('val').textContent = String(Math.round(settings.speed * 100) / 100);
    if (!dragging) $('slider').value = String(speedToPos(settings.speed));

    const hint = stateHint();
    const hintEl = $('stateHint');
    hintEl.textContent = hint.text;
    hintEl.className = 'hint ' + hint.cls;

    // 开关状态
    $('power').classList.toggle('on', settings.enabled);

    // 预设高亮
    document.querySelectorAll('.chip').forEach((chip) => {
      const v = Number(chip.dataset.v);
      chip.classList.toggle('active', settings.enabled && Math.abs(v - settings.speed) < 1e-6);
    });

    // 开关
    TOGGLE_KEYS.forEach((k) => {
      const input = document.querySelector(`input[data-key="${k}"]`);
      if (input) input.checked = !!settings[k];
    });

    // 按钮
    $('btnPause').textContent = settings.enabled ? '暂停加速' : '恢复加速';
    const off = isSiteDisabled();
    const btn = $('btnSiteOff');
    btn.textContent = off ? '恢复本站' : '本站禁用';
    btn.classList.toggle('danger', off);

    // 站点标签
    const s = $('site');
    if (PREVIEW) {
      s.textContent = '预览模式 · example.com';
    } else if (!site) {
      s.textContent = '该页面不支持加速（浏览器内置页）';
    } else {
      const marks = [];
      if (settings.perSite && store.sites[site]) marks.push('独立设置');
      if (!settings.enabled) marks.push('已禁用');
      s.textContent = site.replace(/^https?:\/\//, '') + (marks.length ? ' · ' + marks.join(' · ') : '');
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    // 滑块
    const slider = $('slider');
    slider.addEventListener('input', () => {
      dragging = true;
      const v = snap(posToSpeed(Number(slider.value)));
      $('val').textContent = String(Math.round(v * 100) / 100);
      const hint = stateHintFor(v);
      const hintEl = $('stateHint');
      hintEl.textContent = hint.text;
      hintEl.className = 'hint ' + hint.cls;
      commitSoon({ speed: v, enabled: true });
    });
    const endDrag = () => {
      dragging = false;
      flushNow();
      render();
    };
    slider.addEventListener('change', endDrag);
    slider.addEventListener('pointerup', endDrag);

    // 预设
    const presetBox = $('presets');
    PRESETS.forEach((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.v = String(v);
      b.textContent = v + 'x';
      b.addEventListener('click', () => commit({ speed: v, enabled: true }));
      presetBox.appendChild(b);
    });

    // 开关
    TOGGLE_KEYS.forEach((k) => {
      const input = document.querySelector(`input[data-key="${k}"]`);
      if (!input) return;
      input.addEventListener('change', () => {
        if (k === 'perSite' && input.checked && site) {
          // 打开站点记忆时，把当前值固定到本站，避免之后改全局影响本站
          store.sites[site] = Object.assign({}, store.sites[site], {
            speed: settings.speed,
            enabled: settings.enabled
          });
        }
        commit({ [k]: input.checked });
      });
    });

    // 电源
    $('power').addEventListener('click', () => commit({ enabled: !settings.enabled }));

    // 恢复 1x
    $('btnReset').addEventListener('click', () => commit({ speed: 1, enabled: true }));

    // 暂停 / 恢复
    $('btnPause').addEventListener('click', () => commit({ enabled: !settings.enabled }));

    // 本站禁用 / 恢复
    $('btnSiteOff').addEventListener('click', () => {
      if (!site) return;
      store.global.perSite = true;
      const turningOff = !isSiteDisabled();
      store.sites[site] = Object.assign({}, store.sites[site], { enabled: !turningOff, speed: settings.speed });
      settings = resolve(store, site);
      saveStore(store).then(render);
    });

    // 快捷键设置
    const link = $('linkShortcuts');
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (hasChrome && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      } else {
        link.textContent = 'chrome://extensions/shortcuts';
      }
    });
  }

  function stateHintFor(speed) {
    if (speed > 1) return { text: `页面运行速度 ×${speed}`, cls: 'hot' };
    if (speed < 1) return { text: `页面运行速度 ×${speed}（慢放）`, cls: '' };
    return { text: '原始速度', cls: '' };
  }

  /* ---------------- 启动 ---------------- */
  (async function init() {
    await detectSite();
    store = await loadStore();
    settings = resolve(store, site);
    bind();
    render();
  })();
})();
