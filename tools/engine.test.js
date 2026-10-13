/* Turbo Web —— 加速引擎行为测试（Node 模拟浏览器环境）
 * 运行：node tools/engine.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject.js'), 'utf8');

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

/* ---------------- 最小浏览器环境 ---------------- */
function makeEnv() {
  const env = {};
  let real = 0;
  let rafId = 0;
  const rafQueue = new Map();
  const timeouts = [];
  const intervals = [];

  const sandbox = {
    console,
    Date,
    Math,
    Number,
    JSON,
    Object,
    Array,
    String,
    Boolean,
    isFinite,
    performance: { now: () => real },
    document: {
      documentElement: null,
      getAnimations: () => env.animations,
      querySelectorAll: (sel) => (/video|audio/.test(sel) ? env.media : []),
      addEventListener: () => {},
      createElement: () => ({ style: {}, attachShadow: null, appendChild: () => {} })
    },
    location: { href: 'https://example.com/', origin: 'https://example.com' },
    localStorage: { getItem: () => null, setItem: () => {} },
    MutationObserver: class { observe() {} disconnect() {} },
    CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
    postMessage: () => {},
    requestAnimationFrame: (cb) => { const id = ++rafId; rafQueue.set(id, cb); return id; },
    cancelAnimationFrame: (id) => rafQueue.delete(id),
    setTimeout: (fn, d) => { timeouts.push({ fn, d }); return timeouts.length; },
    setInterval: (fn, d) => { intervals.push({ fn, d }); return intervals.length; },
    clearTimeout: () => {},
    clearInterval: () => {}
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;

  // message 监听收集（派发时由 vm 内部构造 source=window 的事件）
  env.msgListeners = [];
  sandbox.__msgListeners = env.msgListeners;
  sandbox.addEventListener = (type, fn) => {
    if (type === 'message') env.msgListeners.push(fn);
  };

  env.sandbox = sandbox;
  env.animations = [];
  env.media = [];
  env.timeouts = timeouts;
  env.intervals = intervals;
  env.ctx = null;
  env.fireMessage = (data) => {
    const fire = sandbox.__fireMessage || sandbox.__fireForeign;
    if (fire) fire(data);
  };
  env.fireForeignMessage = (data) => {
    if (sandbox.__fireForeign) sandbox.__fireForeign(data);
  };

  /** 手动触发一次 rAF 队列，t 为 DOMHighResTimeStamp */
  env.flushRAF = (t) => {
    const pending = [...rafQueue.entries()];
    rafQueue.clear();
    for (const [, cb] of pending) cb(t);
    return pending.length;
  };
  env.advance = (ms) => { real += ms; };
  env.now = () => real;

  return env;
}

function loadEngine(env) {
  const ctx = vm.createContext(env.sandbox);
  env.ctx = ctx;
  vm.runInContext(CODE, ctx, { filename: 'inject.js' });
  // 在 vm 内部构造事件：source 为该窗口自身 / 其他窗口
  vm.runInContext(
    'globalThis.__fireMessage = (data) => {' +
    '  for (let i = 0; i < __msgListeners.length; i++) { __msgListeners[i]({ source: window, data }); }' +
    '};' +
    'globalThis.__fireForeign = (data) => {' +
    '  for (let i = 0; i < __msgListeners.length; i++) { __msgListeners[i]({ source: {}, data }); }' +
    '};',
    ctx
  );
  return env.sandbox.window.__turboEngine;
}

/* ================= 用例 ================= */
console.log('\n[1] 虚拟时间轴：performance.now 按倍率推进');
{
  const env = makeEnv();
  const engine = loadEngine(env);

  const before = env.sandbox.performance.now();
  engine.apply({ speed: 2, enabled: true, raf: true });
  env.advance(100);
  const after2x = env.sandbox.performance.now();
  check('2x 时 100ms 真实时间 → 200ms 虚拟时间', near(after2x - before, 200), `实际 ${after2x - before}`);

  engine.apply({ speed: 0.5, enabled: true, raf: true });
  const t0 = env.sandbox.performance.now();
  env.advance(100);
  const after05 = env.sandbox.performance.now();
  check('0.5x 时 100ms 真实时间 → 50ms 虚拟时间', near(after05 - t0, 50), `实际 ${after05 - t0}`);

  // 变速瞬间不得跳变
  const tA = env.sandbox.performance.now();
  engine.apply({ speed: 4, enabled: true, raf: true });
  const tB = env.sandbox.performance.now();
  check('切换倍率瞬间虚拟时间连续（无跳变）', near(tA, tB, 1e-9), `${tA} → ${tB}`);

  engine.apply({ speed: 1, enabled: false });
  const tC = env.sandbox.performance.now();
  check('关闭加速后回到真实时间', near(tC, env.now(), 1e-9));
}

console.log('\n[2] requestAnimationFrame：回调收到虚拟时间戳');
{
  const env = makeEnv();
  const engine = loadEngine(env);

  engine.apply({ speed: 3, enabled: true, raf: true });
  const base = env.sandbox.performance.now();

  let stamp = null;
  env.sandbox.window.requestAnimationFrame((t) => { stamp = t; });
  env.advance(16);
  env.flushRAF(env.now());

  check('rAF 回调时间戳被加速 3 倍', near(stamp - base, 48, 1e-6), `stamp-base=${stamp - base}`);
  check('rAF 回调确实被调用', stamp !== null);
}

console.log('\n[3] 关闭「JS 动画」后 rAF 直通');
{
  const env = makeEnv();
  const engine = loadEngine(env);
  engine.apply({ speed: 4, enabled: true, raf: false });

  let stamp = null;
  env.sandbox.window.requestAnimationFrame((t) => { stamp = t; });
  env.advance(16);
  env.flushRAF(env.now());
  check('raf:false 时回调收到真实时间戳', near(stamp, env.now(), 1e-9));
}

console.log('\n[4] 定时器：延迟被压缩');
{
  const env = makeEnv();
  const engine = loadEngine(env);
  const W = env.sandbox.window;
  const lastT = () => env.timeouts[env.timeouts.length - 1];

  engine.apply({ speed: 2, enabled: true, timers: true });
  W.setTimeout(() => {}, 200);
  check('2x 时 200ms 延时 → 100ms', lastT().d === 100, `实际 ${lastT().d}`);

  engine.apply({ speed: 1, enabled: true, timers: true });
  W.setTimeout(() => {}, 200);
  check('1x 时保持 200ms', lastT().d === 200, `实际 ${lastT().d}`);

  engine.apply({ speed: 4, enabled: true, timers: false });
  W.setTimeout(() => {}, 400);
  check('timers:false 时不缩放', lastT().d === 400, `实际 ${lastT().d}`);

  engine.apply({ speed: 4, enabled: true, timers: true });
  W.setTimeout(() => {}, 0);
  check('delay=0 原样透传', lastT().d === 0, `实际 ${lastT().d}`);

  // 链式 setInterval：倍率变化后已在运行的间隔立即跟随
  engine.apply({ speed: 2, enabled: true, timers: true });
  let calls = 0;
  const id = W.setInterval(() => { calls++; }, 1000);
  check('interval 首次调度按倍率（1000 → 500ms）', lastT().d === 500, `实际 ${lastT().d}`);

  lastT().fn();
  check('interval 回调被执行', calls === 1, `calls=${calls}`);

  engine.apply({ speed: 4, enabled: true, timers: true });
  lastT().fn();   // 本轮到期后排下一轮
  check('调高倍率后下一轮立即采用新倍率（→ 250ms）', lastT().d === 250, `实际 ${lastT().d}`);

  engine.apply({ speed: 1, enabled: true, timers: true });
  lastT().fn();
  check('调回 1x 后恢复原间隔（→ 1000ms）', lastT().d === 1000, `实际 ${lastT().d}`);

  W.clearInterval(id);
  const before = env.timeouts.length;
  lastT().fn();   // 模拟队列中残留的定时器到期
  check('clearInterval 后不再继续调度', env.timeouts.length === before,
    `新增 ${env.timeouts.length - before} 个`);
}

console.log('\n[5] Web Animations：playbackRate 跟随倍率');
{
  const env = makeEnv();
  const a1 = { playbackRate: 1 };
  const a2 = { playbackRate: 1 };
  env.animations = [a1, a2];
  const engine = loadEngine(env);

  engine.apply({ speed: 2.5, enabled: true, animations: true });
  check('动画 playbackRate → 2.5', a1.playbackRate === 2.5 && a2.playbackRate === 2.5,
    `${a1.playbackRate}/${a2.playbackRate}`);

  engine.apply({ speed: 2.5, enabled: true, animations: false });
  check('关闭 CSS 动画项后恢复 1', a1.playbackRate === 1 && a2.playbackRate === 1,
    `${a1.playbackRate}/${a2.playbackRate}`);

  engine.apply({ speed: 5, enabled: true, animations: true });
  check('重新开启后 → 5', a1.playbackRate === 5, `${a1.playbackRate}`);
}

console.log('\n[6] 媒体元素：速率、上限与音调');
{
  const env = makeEnv();
  const v = { playbackRate: 1, preservesPitch: false, paused: false };
  env.media = [v];
  const engine = loadEngine(env);

  engine.apply({ speed: 2, enabled: true, media: true, keepPitch: true });
  check('视频 playbackRate → 2', v.playbackRate === 2, `${v.playbackRate}`);
  check('preservesPitch 被设为 true', v.preservesPitch === true);

  engine.apply({ speed: 40, enabled: true, media: true });
  check('超过浏览器上限时钳制到 16', v.playbackRate === 16, `${v.playbackRate}`);

  engine.apply({ speed: 3, enabled: true, media: false });
  check('关闭媒体加速后恢复 1', v.playbackRate === 1, `${v.playbackRate}`);
}

console.log('\n[7] 倍率边界与容错');
{
  const env = makeEnv();
  const engine = loadEngine(env);

  engine.apply({ speed: -5, enabled: true });
  env.advance(10);
  check('负数倍率被钳制（不倒退）', env.sandbox.performance.now() >= 0);

  engine.apply({ speed: 'abc', enabled: true });
  check('非法倍率回退为 1', engine.speed === 1, `speed=${engine.speed}`);

  engine.apply(undefined);
  check('空配置不报错并使用默认值', engine.settings.speed === 1 && engine.settings.enabled === true);

  check('设置的字段完整合并', engine.settings.media === true && engine.settings.smil === false);
}

console.log('\n[8] 消息通道');
{
  const env = makeEnv();
  const engine = loadEngine(env);
  check('message 监听已注册', env.msgListeners.length === 1, `count=${env.msgListeners.length}`);

  env.fireMessage({ __turbo: true, type: 'apply', settings: { speed: 7, enabled: true } });
  check('收到 apply 消息后倍率生效', engine.speed === 7, `speed=${engine.speed}`);

  env.fireForeignMessage({ __turbo: true, type: 'apply', settings: { speed: 9, enabled: true } });
  check('忽略其他窗口的消息', engine.speed === 7, `speed=${engine.speed}`);

  env.fireMessage({ hello: 'world' });
  check('忽略无关消息', engine.speed === 7, `speed=${engine.speed}`);
}

console.log('\n' + (failures === 0 ? '全部通过 ✅' : `失败 ${failures} 项 ❌`));
process.exit(failures === 0 ? 0 : 1);
