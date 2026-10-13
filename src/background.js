/* ============================================================
 * Turbo Web —— 后台服务（MV3 service worker）
 *
 * 职责：
 *   - 维护当前活跃标签页，把快捷键指令路由过去
 *   - 依据页面上报的速度更新工具栏徽标
 *   - 首次安装时初始化配置
 * ============================================================ */
'use strict';
importScripts('shared.js');

const T = self.TurboShared;
const { KEY, DEFAULTS, normalize, clampSpeed, nextStep } = T;

const COMMANDS = {
  'turbo-up': 'up',
  'turbo-down': 'down',
  'turbo-toggle': 'toggle',
  'turbo-reset': 'reset'
};

let activeTabId = null;

/* ---------------- 徽标 ---------------- */
function updateBadge(tabId, speed, enabled) {
  const show = !!enabled && Math.abs(speed - 1) > 0.001;
  const text = show ? T.formatSpeed(speed) : '';
  try {
    chrome.action.setBadgeText({ tabId, text });
    if (show) {
      chrome.action.setBadgeBackgroundColor({
        tabId,
        color: speed > 1 ? '#f43f5e' : '#3b82f6'
      });
    }
  } catch (e) { /* 标签页可能已关闭 */ }
}

/* ---------------- 消息处理 ---------------- */
/* ---------------- 主世界源码分发 ----------------
 * 隔离世界在页面 CSP 拦截 chrome-extension:// 外链时，
 * 向后台索取引擎源码做内联注入。service worker 端 fetch
 * 不受页面 CSP 限制，这条路必定拿得到。 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'turbo:source') return false;
  fetch(chrome.runtime.getURL(msg.file))
    .then((r) => r.text())
    .then((code) => sendResponse({ code }))
    .catch(() => sendResponse({ code: null }));
  return true;   // 保持消息通道，等待异步响应
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || typeof msg.type !== 'string') return;
  const tabId = sender && sender.tab ? sender.tab.id : null;
  if (tabId == null) return;

  if (msg.type === 'turbo:active') {
    activeTabId = tabId;
  } else if (msg.type === 'turbo:badge') {
    updateBadge(tabId, Number(msg.speed) || 1, msg.enabled !== false);
  }
});

chrome.tabs.onActivated.addListener((info) => {
  activeTabId = info.tabId;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) activeTabId = null;
});

/* ---------------- 快捷键 ---------------- */
function adjustGlobal(mode) {
  chrome.storage.local.get(KEY, (res) => {
    const store = normalize(res[KEY]);
    const cur = store.global;
    let speed = clampSpeed(cur.speed);
    let enabled = cur.enabled !== false;

    if (mode === 'up') speed = nextStep(speed, 1);
    else if (mode === 'down') speed = nextStep(speed, -1);
    else if (mode === 'reset') { speed = 1; enabled = true; }
    else if (mode === 'toggle') enabled = !enabled;
    else return;

    store.global.speed = speed;
    store.global.enabled = enabled;
    chrome.storage.local.set({ [KEY]: store });
  });
}

function dispatch(mode) {
  if (activeTabId == null) {
    adjustGlobal(mode);
    return;
  }
  try {
    chrome.tabs.sendMessage(activeTabId, { type: 'turbo:adjust', mode }, () => {
      if (chrome.runtime.lastError) {
        // 当前标签没有内容脚本（chrome:// 等受保护页面），退化为改全局配置
        activeTabId = null;
        adjustGlobal(mode);
      }
    });
  } catch (e) {
    activeTabId = null;
    adjustGlobal(mode);
  }
}

chrome.commands.onCommand.addListener((command) => {
  const mode = COMMANDS[command];
  if (mode) dispatch(mode);
});

/* ---------------- 安装初始化 ---------------- */
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(KEY, (res) => {
    if (!res[KEY]) {
      chrome.storage.local.set({ [KEY]: { global: Object.assign({}, DEFAULTS), sites: {} } });
    }
  });
});
