/* 探针：找到扩展插入的悬浮控制器宿主，报告它的真实几何。
   DOM 是两个世界共享的，所以页面脚本能看到宿主元素本身。 */
(function () {
  var logs = [];
  function log(s) { logs.push(s); }
  function paint() { document.getElementById('out').textContent = logs.join('\n'); }

  function findHosts() {
    var out = [];
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) out.push(all[i]);
    }
    return out;
  }

  function dump(tag) {
    var hosts = findHosts();
    log('[' + tag + '] 带 shadowRoot 的元素数：' + hosts.length);
    for (var i = 0; i < hosts.length; i++) {
      var h = hosts[i];
      var r = h.getBoundingClientRect();
      var cs = getComputedStyle(h);
      log('  #' + i + ' tag=' + h.tagName +
          ' rect=(' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' +
          Math.round(r.width) + 'x' + Math.round(r.height) + ')');
      log('      position=' + cs.position + ' left=' + cs.left + ' right=' + cs.right +
          ' top=' + cs.top + ' bottom=' + cs.bottom);
      log('      inline: left=' + h.style.left + ' right=' + h.style.right +
          ' top=' + h.style.top + ' bottom=' + h.style.bottom);
      var sr = h.shadowRoot;
      var cap = sr && sr.getElementById ? sr.getElementById('k') : null;
      if (cap) {
        var cr = cap.getBoundingClientRect();
        log('      指针胶囊 cap rect=(' + Math.round(cr.left) + ',' + Math.round(cr.top) + ' ' +
            Math.round(cr.width) + 'x' + Math.round(cr.height) + ')  文本="' + cap.textContent + '"');
        log('      胶囊可见=' + (cr.width > 0 && cr.height > 0 && cr.top >= 0 &&
            cr.left >= 0 && cr.right <= innerWidth && cr.bottom <= innerHeight));
      } else {
        log('      未找到 #k（shadow 内容读不到或未挂载）');
      }
    }
    log('  视口 = ' + innerWidth + 'x' + innerHeight);
  }

  setTimeout(function () { dump('t=1500ms'); paint(); }, 1500);
  setTimeout(function () {
    dump('t=3500ms');
    log('');
    log('引擎就绪标记 = ' + document.documentElement.getAttribute('data-turbo-ready'));
    log('注入路径     = ' + document.documentElement.getAttribute('data-turbo-boot'));
    paint();
  }, 3500);
  setTimeout(paint, 200);
})();
