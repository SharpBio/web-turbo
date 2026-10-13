/* ============================================================
 * Turbo Web —— 页面内悬浮控制器（隔离世界）
 *
 * 用途：手机浏览器（狐猴 / Kiwi 等）没有工具栏扩展图标、
 * 也点不到 popup，用它直接在网页上调速。桌面端同样可用，
 * 可在 popup 的「高级选项」里关闭。
 *
 * 定位模型（重要）：
 *   宿主 div 是一个 0×0 的 fixed「锚点」，不承载任何尺寸；
 *   shadow 里的 .wrap 用 absolute + right/bottom 贴住锚点，
 *   于是锚点坐标 = 控件的「右边缘 / 胶囊底边缘」。
 *   这样不论面板展开还是收起，胶囊都停在原地，不会跟着跳。
 *   （早期版本对宿主同时设 left/right/top/bottom，会被拉成
 *     畸形盒子，位置随视口大小漂移，已修掉。）
 * ============================================================ */
(() => {
  'use strict';
  if (window.__turboFloating) return;

  const T = globalThis.TurboShared;
  const { nextStep, label } = T;

  const PRESETS = [0.5, 1, 1.5, 2, 3, 4, 8];
  const POS_KEY = '__turboFloatPos';
  const MARGIN = 4;
  const GAP_BELOW_CAP = 78;    // 默认位置：距底 78px，避开手机浏览器底栏

  let host = null;
  let root = null;
  let wrap = null;
  let cap = null;
  let panel = null;
  let valEl = null;
  let chipsEl = null;
  let pauseBtn = null;
  let noteEl = null;
  let settings = null;
  let onChange = null;
  let expanded = false;
  let drag = null;
  let mode = 'main';

  let pos = { x: 0, y: 0 };    // 锚点：控件右边缘、胶囊底边缘（视口坐标）

  const CSS = [
    ':host{all:initial}',
    '.wrap{position:absolute;right:0;bottom:0;display:flex;flex-direction:column;',
         'align-items:flex-end;gap:8px;font-family:-apple-system,"Segoe UI",system-ui,sans-serif;',
         'user-select:none;-webkit-user-select:none;touch-action:none}',
    '.wrap.down{top:0;bottom:auto;flex-direction:column-reverse}',
    '.cap{display:flex;align-items:center;gap:6px;padding:9px 15px;border-radius:999px;',
         'background:rgba(14,17,28,.88);border:1px solid rgba(255,255,255,.14);color:#fff;',
         'font-size:13px;font-weight:700;letter-spacing:.3px;cursor:pointer;white-space:nowrap;',
         'box-sizing:border-box;box-shadow:0 6px 20px rgba(0,0,0,.42);backdrop-filter:blur(10px);',
         'transition:transform .12s ease,background .18s ease}',
    '.cap.on{background:linear-gradient(120deg,rgba(124,58,237,.92),rgba(6,182,212,.85));border-color:transparent}',
    '.cap:active{transform:scale(.94)}',
    '.dot{width:7px;height:7px;border-radius:50%;background:#64748b}',
    '.cap.on .dot{background:#fff;box-shadow:0 0 8px rgba(255,255,255,.9)}',
    '.panel{display:none;box-sizing:border-box;width:198px;padding:11px;border-radius:15px;',
           'background:rgba(13,16,26,.94);border:1px solid rgba(255,255,255,.11);',
           'box-shadow:0 14px 40px rgba(0,0,0,.5);backdrop-filter:blur(14px)}',
    '.panel.show{display:block}',
    '.row{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.step{flex:1;padding:8px 0;border-radius:9px;border:1px solid rgba(255,255,255,.1);',
           'background:rgba(255,255,255,.06);color:#dbe2f0;font-size:12px;font-weight:600;cursor:pointer}',
    '.step:active{background:rgba(255,255,255,.16)}',
    '.big{font-size:16px;font-weight:800;font-variant-numeric:tabular-nums;color:#fff;min-width:52px;text-align:center}',
    '.chips{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:9px}',
    '.chip{padding:6px 0;border-radius:8px;border:1px solid rgba(255,255,255,.1);',
           'background:rgba(255,255,255,.05);color:#b8c1d4;font-size:11.5px;font-weight:600;cursor:pointer}',
    '.chip.active{background:linear-gradient(120deg,rgba(124,58,237,.9),rgba(6,182,212,.8));color:#fff;border-color:transparent}',
    '.acts{display:flex;gap:5px;margin-top:9px}',
    '.act{flex:1;padding:7px 0;border-radius:8px;border:1px solid rgba(255,255,255,.1);',
          'background:transparent;color:#9aa3b8;font-size:11.5px;cursor:pointer}',
    '.act:active{background:rgba(255,255,255,.1)}',
    '.note{display:none;margin-top:8px;padding:6px 8px;border-radius:7px;line-height:1.45;',
          'background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.28);',
          'color:#fcd34d;font-size:10.5px;font-weight:500}',
    '.note.show{display:block}'
  ].join('');

  /* ---------------- 位置读写 ---------------- */
  function defaultPos() {
    return {
      x: window.innerWidth - 14,
      y: window.innerHeight - GAP_BELOW_CAP
    };
  }

  function readPos() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (typeof p.x !== 'number' || typeof p.y !== 'number') return null;
      if (!isFinite(p.x) || !isFinite(p.y)) return null;
      return p;
    } catch (e) { return null; }
  }

  function savePos() {
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) { /* 忽略 */ }
  }

  const capH = () => (cap && cap.offsetHeight) || 37;
  const capW = () => (cap && cap.offsetWidth) || 62;
  const wrapW = () => (wrap && wrap.offsetWidth) || capW();

  /** 横向夹取：保证控件（含展开的面板）左侧不出界 */
  function clampX(minWidth) {
    const lo = minWidth + MARGIN;
    const hi = Math.max(lo, window.innerWidth - MARGIN);
    pos.x = Math.min(Math.max(lo, pos.x), hi);
  }

  /** 纵向夹取：只约束胶囊本身，展开时由 applyPos 决定往上还是往下弹 */
  function clampY() {
    const lo = capH() + MARGIN;
    const hi = Math.max(lo, window.innerHeight - MARGIN);
    pos.y = Math.min(Math.max(lo, pos.y), hi);
  }

  /** 把锚点写进样式；上方放不下时把面板翻到胶囊下面 */
  function applyPos() {
    if (!host || !wrap) return;
    const needUp = (wrap.offsetHeight || capH()) + MARGIN;
    const down = (pos.y - needUp) < MARGIN;

    wrap.classList.toggle('down', down);
    host.style.left = Math.round(pos.x) + 'px';

    if (down) {
      host.style.top = Math.round(Math.max(MARGIN, pos.y - capH())) + 'px';
      host.style.bottom = 'auto';
    } else {
      host.style.top = 'auto';
      host.style.bottom = Math.round(Math.max(MARGIN, window.innerHeight - pos.y)) + 'px';
    }
  }

  function relayout() {
    clampX(wrapW());
    clampY();
    applyPos();
  }

  /* ---------------- 构建 ---------------- */
  function build() {
    host = document.createElement('div');
    // 0×0 锚点：不设 right/bottom，避免被拉伸成畸形盒子
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;margin:0;padding:0;' +
      'border:0;z-index:2147483646;pointer-events:none;';
    root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML =
      '<div class="panel" id="p">' +
        '<div class="row">' +
          '<button class="step" id="down" type="button">慢</button>' +
          '<div class="big" id="v">1x</div>' +
          '<button class="step" id="up" type="button">快</button>' +
        '</div>' +
        '<div class="chips" id="c"></div>' +
        '<div class="acts">' +
          '<button class="act" id="pause" type="button">暂停加速</button>' +
          '<button class="act" id="hide" type="button">隐藏</button>' +
        '</div>' +
        '<div class="note" id="n"></div>' +
      '</div>' +
      '<div class="cap" id="k"><span class="dot"></span><span id="t">1x</span></div>';

    root.appendChild(wrap);

    panel = root.getElementById('p');
    cap = root.getElementById('k');
    valEl = root.getElementById('v');
    chipsEl = root.getElementById('c');
    pauseBtn = root.getElementById('pause');
    noteEl = root.getElementById('n');

    // 锚点本身不吃事件，交互全部交给胶囊与面板
    wrap.style.pointerEvents = 'auto';

    PRESETS.forEach((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.v = String(v);
      b.textContent = label(v);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        emit({ speed: v, enabled: true });
      });
      chipsEl.appendChild(b);
    });

    root.getElementById('up').addEventListener('click', (e) => {
      e.stopPropagation();
      emit({ speed: nextStep(settings.speed, 1), enabled: true });
    });

    root.getElementById('down').addEventListener('click', (e) => {
      e.stopPropagation();
      emit({ speed: nextStep(settings.speed, -1), enabled: true });
    });

    pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      emit({ enabled: !settings.enabled });
    });

    root.getElementById('hide').addEventListener('click', (e) => {
      e.stopPropagation();
      emit({ floating: false });
    });

    bindDrag();
    return host;
  }

  /* ---------------- 拖拽 ---------------- */
  function bindDrag() {
    cap.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drag = {
        sx: e.clientX, sy: e.clientY,
        ox: pos.x, oy: pos.y,
        moved: false
      };
      try { cap.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    });

    cap.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) drag.moved = true;
      if (!drag.moved) return;
      pos.x = drag.ox + dx;
      pos.y = drag.oy + dy;
      clampX(capW());
      clampY();
      applyPos();
    });

    cap.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      const wasTap = drag && !drag.moved;
      if (drag && drag.moved) savePos();
      drag = null;
      if (wasTap) toggle();
    });

    cap.addEventListener('pointercancel', () => { drag = null; });
  }

  function toggle() {
    expanded = !expanded;
    panel.classList.toggle('show', expanded);
    if (expanded) {
      // 展开后控件变宽，需要重新夹取，避免面板左侧出界
      clampX(wrapW());
    }
    applyPos();
  }

  function emit(patch) {
    if (onChange) onChange(patch);
  }

  /* ---------------- 运行模式提示 ---------------- */
  const MODE_TEXT = {
    dom: '本站内容安全策略（CSP）拦住了扩展脚本，已降级运行：' +
         'CSS 动画 / 过渡 / 视频音频照常加速，JS 时间轴与页面定时器不受控。'
  };

  function renderNote() {
    if (!noteEl) return;
    noteEl.textContent = mode === 'dom' ? MODE_TEXT.dom : '';
    noteEl.classList.toggle('show', mode === 'dom');
    if (expanded) applyPos();
  }

  /** 'main' = 主世界引擎（全功能）；'dom' = 隔离世界降级引擎 */
  function setMode(next) {
    const m = (next === 'dom') ? 'dom' : 'main';
    if (m === mode && host) return;
    mode = m;
    renderNote();
  }

  /* ---------------- 对外接口 ---------------- */
  function mount(cfg, callback) {
    settings = cfg;
    onChange = callback;

    if (!host) {
      const mountTo = document.body || document.documentElement;
      if (!mountTo) return false;          // 文档还没准备好，交由调用方稍后重试
      mountTo.appendChild(build());
      pos = readPos() || defaultPos();
      relayout();
      window.addEventListener('resize', relayout);
      window.addEventListener('orientationchange', () => setTimeout(relayout, 250));
    }

    update(cfg);
    return true;
  }

  function update(cfg) {
    settings = cfg;
    if (!host) return;

    const txt = cfg.enabled ? label(cfg.speed) : '已暂停';
    valEl.textContent = txt;
    root.getElementById('t').textContent = txt;
    cap.classList.toggle('on', cfg.enabled && Math.abs(cfg.speed - 1) > 0.001);
    pauseBtn.textContent = cfg.enabled ? '暂停加速' : '恢复加速';

    chipsEl.querySelectorAll('.chip').forEach((c) => {
      const v = Number(c.dataset.v);
      c.classList.toggle('active', cfg.enabled && Math.abs(v - cfg.speed) < 1e-6);
    });

    renderNote();
  }

  function destroy() {
    if (!host) return;
    if (host.parentNode) host.parentNode.removeChild(host);
    window.removeEventListener('resize', relayout);
    host = null;
    root = null;
    wrap = null;
    cap = null;
    panel = null;
    valEl = null;
    chipsEl = null;
    pauseBtn = null;
    noteEl = null;
    expanded = false;
    drag = null;
  }

  function isMounted() { return !!host; }

  window.__turboFloating = { mount, update, destroy, isMounted, setMode };
})();
