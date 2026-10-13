/* ============================================================
 * 严格 CSP 下的注入验证脚本（同源外链，script-src 'self' 允许）
 *
 * 验证目标：站点设置了 CSP 之后，扩展还能不能加速。
 * 三级策略的观察点：
 *   data-turbo-boot = external → 外链脚本进主世界了（全功能）
 *   data-turbo-boot = inline   → 外链被拦、内联补上了（全功能）
 *   data-turbo-boot = blocked  → 两种都进不去，已切降级引擎
 *                                只能看 CSS 动画 / 媒体有没有被提速
 * ============================================================ */
(function () {
  var logs = [];
  function log(s) { logs.push(s); }
  function paint() {
    var el = document.getElementById('out');
    if (el) el.textContent = logs.join('\n');
  }

  var boot = document.documentElement.getAttribute('data-turbo-boot') || '(none)';
  var ready = document.documentElement.hasAttribute('data-turbo-ready');
  var engine = !!window.__turboEngine;

  log('页面 CSP              : strict（script-src \'self\'，无 unsafe-inline）');
  log('注入路径              : ' + boot);
  log('主世界引擎可用        : ' + (engine ? 'yes' : 'no'));
  log('跨世界就绪标记        : ' + (ready ? 'yes' : 'no'));
  log('运行模式              : ' + (engine ? 'main（全功能）' : 'dom（隔离世界降级）'));

  // CSS 动画探针：降级引擎也必须能接管它
  var box = document.createElement('div');
  box.style.cssText = 'width:20px;height:20px;background:#f43f5e;animation:sp 1s linear infinite';
  var st = document.createElement('style');
  st.textContent = '@keyframes sp{to{transform:rotate(360deg)}}';
  document.head.appendChild(st);
  document.body.appendChild(box);

  // 媒体探针：降级引擎同样要能改 playbackRate
  var audio = document.createElement('audio');
  audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  audio.preload = 'auto';
  document.body.appendChild(audio);

  function probe(label, final) {
    var anims = document.getAnimations ? document.getAnimations() : [];
    var rates = anims.map(function (a) { return a.playbackRate; });
    var ok = rates.length > 0 && rates.every(function (r) { return Math.abs(r - 4) < 0.01; });
    log(label + ' CSS 动画 playbackRate : [' + rates.join(', ') + ']  → ' + (ok ? 'PASS' : 'FAIL'));
    log(label + ' audio.playbackRate    : ' + audio.playbackRate + '  → '
        + (Math.abs(audio.playbackRate - 4) < 0.01 ? 'PASS' : 'FAIL'));
    if (final) {
      // 注入路径是动态变化的，必须在最后再读一次
      log('最终注入路径           : ' + (document.documentElement.getAttribute('data-turbo-boot') || '(none)'));
      log('最终运行模式           : ' + (window.__turboEngine ? 'main（全功能）' : 'dom（隔离世界降级）'));
    }
    return ok;
  }

  // 主世界可用时手动下发 4x；降级模式下速度来自扩展存储（测试构建默认 4x）
  if (engine) {
    window.postMessage({
      __turbo: true, type: 'apply',
      settings: {
        speed: 4, enabled: true, raf: true, timers: true,
        animations: true, media: true, keepPitch: true,
        smil: false, frameRepeat: false, dateNow: false
      }
    }, '*');
  }

  setTimeout(function () { probe('[t=1200ms]', false); paint(); }, 1200);
  setTimeout(function () {
    probe('[t=2600ms]', true);
    var verdict = logs.join(' ').indexOf('FAIL') === -1;
    log('');
    log(verdict ? '=== 严格 CSP 下加速生效 ===' : '=== 存在失败项 ===');
    paint();
  }, 2600);

  setTimeout(paint, 300);
})();
