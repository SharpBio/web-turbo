# 架构与设计取舍

这份文档解释 Turbo Web **为什么这么实现**，而不只是做了什么。
所有结论都标注了实测环境；没有实测依据的判断会明确写成「推断」。

## 1. 三个执行环境

```
┌─ Service Worker（background.js）──────────────────┐
│  快捷键分发 · 工具栏徽标 · 引擎源码分发            │
└───────────────────────┬──────────────────────────┘
                        │ chrome.runtime.sendMessage
┌───────────────────────▼──────────────────────────┐
│ 隔离世界 ISOLATED（content.js / floating.js /     │
│                    fallback.js / shared.js）      │
│  读 storage · 注入引擎 · 悬浮控制器 · 降级引擎     │
└───────────────────────┬──────────────────────────┘
                        │ <script src=chrome-extension://…>
                        │ window.postMessage
┌───────────────────────▼──────────────────────────┐
│ 页面主世界 MAIN（inject.js）                      │
│  虚拟时间轴 · 定时器缩放 · WAAPI · 媒体            │
└──────────────────────────────────────────────────┘
```

| | 隔离世界 | 页面主世界 |
|---|---|---|
| `window` 全局变量 | 独立一份 | 页面自己的 |
| DOM | **与页面共享** | 与页面共享 |
| `chrome.*` API | 可用 | 不可用 |
| 是否受页面 CSP 约束 | 不受约束 | 插入的脚本仍要走注入通道 |

**最关键的一条事实：两个世界的 JS 全局不共享，但 DOM 是同一个。**
这决定了整套设计——需要改写 `performance.now` 就必须进主世界；
而 `document.getAnimations()`、`video.playbackRate`、SVG 的 `setCurrentTime()`
在隔离世界就能操作，所以降级引擎不需要进主世界。

## 2. 注入机制：三级保障

### 为什么不用 `world: "MAIN"`

`content_scripts[].world: "MAIN"` 是 **Chrome 111** 才支持的字段。安卓端支持扩展的
浏览器内核普遍偏老（狐猴浏览器为 Chromium 107），manifest 里出现它，内核直接判定
「此扩展程序可能已损坏」并拒绝加载整个扩展。

代价与收益对比如下：

| | `world: "MAIN"` | `<script>` 标签注入 |
|---|---|---|
| 内核要求 | 111+ | 88+（MV3 起点） |
| 执行时机 | **同步**，保证早于页面脚本 | 异步，晚几十毫秒 |
| 页面 CSP | 完全无视 | 需确认是否被拦（见下） |

`world: "MAIN"` 的唯一实质优势是同步执行。而实测表明 `<script>` 注入在 CSP 上
并不吃亏（见 2.2），于是选通用方案。

### 2.1 注入链路（`src/content.js`）

```
bootEngine()
  └─ 外链注入 <script src="chrome-extension://…/src/inject.js">
       ├─ load   → 移除节点，等就绪标记
       ├─ error  → 立即 tryInline()          ← 确定信号，优先于超时
       ├─ 1.5s 未就绪 → tryInline()          ← 兜底：向 background 取源码内联
       └─ 3.5s 未就绪 → useFallback()        ← 降级到隔离世界引擎
                                           └─ watchUpgrade() 持续观察，
                                              主世界一旦打通立刻升回全功能
```

时间阈值放宽到秒级是**刻意迁就手机**：低端机上脚本就绪可能就是慢，
过早降级会把「JS 时间轴 + 定时器」两项能力白白丢掉。

### 2.2 页面 CSP 到底拦不拦扩展脚本

这一点最容易被想错，所以单独说，并给出实测方法。

> **实测结论（Chromium 140，服务端下发 `Content-Security-Policy:
> default-src 'none'; script-src 'self'`）：浏览器控制台里只有页面自己的
> `data:` 媒体被拦，`chrome-extension://` 脚本零违规。**
> 也就是说，**页面 CSP 不会拦截扩展资源**。

排查时走过的弯路：一开始看到「页面解析时引擎不在」就判定 CSP 拦截。
真实原因是外链脚本异步加载，页面脚本跑得比它快。
**判定手段**是用 `--enable-logging=stderr` 抓浏览器违规日志，而不是靠推断：

```bash
msedge --headless=new --enable-logging=stderr --load-extension=. \
  --virtual-time-budget=9000 --dump-dom http://127.0.0.1:8878/tools/verify/csp.html \
  2>&1 | grep -i "content security policy"
```

### 2.3 跨世界怎么判断「引擎就绪」

隔离世界**读不到** `window.__turboEngine`（主世界全局不共享）。
但 DOM 共享，所以引擎在 `documentElement` 上打标记：

| 属性 | 含义 |
|---|---|
| `data-turbo-ready` | 引擎已启动 |
| `data-turbo-boot` | 注入路径：`external` / `inline` / `blocked` |

这也是 `tools/verify/*.html` 这些验证页能观测扩展状态的原因——页面脚本
同样能读到这些 DOM 属性。

## 3. 虚拟时间轴（`src/inject.js`）

### 双锚点换算

```js
let anchorReal    = nativeNow();   // 真实时间锚点
let anchorVirtual = anchorReal;    // 虚拟时间锚点
const toVirtual   = (t) => anchorVirtual + (t - anchorReal) * speed;
```

`requestAnimationFrame` 回调和 `performance.now()` 都经过 `toVirtual`。
变速时只重算锚点、不重置历史，所以**虚拟时间连续，不跳变也不倒退**：

```js
function setSpeed(next) {
  const r = nativeNow();
  anchorVirtual = toVirtual(r);   // 先按旧倍率结算到此刻
  anchorReal = r;
  speed = next;                   // 再换新倍率
}
```

这一点必须靠测试守住——`tools/engine.test.js` 里有专门的连续性断言。

### `setInterval` 为什么改成链式调度

如果只是 `nativeSetInterval(handler, delay / speed)`，那么用户在中途改倍率时，
**已经在跑的间隔仍按旧延迟走完这一轮**，体感就是「拖了滑块轮播要等一下才变快」。

改成负数 id 的链式 `setTimeout` 后，每一轮重新读取当前倍率：

```js
const schedule = () => {
  const d = Math.max(1, entry.base / intervalRate());   // 每轮现算
  entry.timer = nativeSetTimeout(() => { …; schedule(); }, d);
};
```

副作用与处理：

- 用负数 id 与原生 id 空间隔离，`clearInterval` 先查这张表再回退到原生；
- `clearTimeout` 容错处理「用 clearTimeout 清理 setInterval 返回值」的页面；
- 回调抛错后仍继续循环，与原生行为一致。

### 动画与媒体的巡检

`document.getAnimations()` 返回的是**活的**动画列表，新的动画随时出现，
所以巡检要覆盖三种触发源：定时巡检（200ms）、MutationObserver（`class` / `style`
属性与子树变化）、`animationstart` / `transitionstart` / `play` 事件。

媒体倍率钳制在 16x——这是浏览器 `playbackRate` 的实际上限，设更高会被忽略。

## 4. 降级引擎（`src/fallback.js`）

主世界进不去时启动。它能做：

| 能力 | 依据 |
|---|---|
| CSS `animation` / `transition` / WAAPI | `document.getAnimations()` 跨世界可用 |
| `video` / `audio` 的 `playbackRate` | DOM 共享 |
| SVG SMIL 的 `setCurrentTime()` | DOM 共享 |

做不到：

| 能力 | 原因 |
|---|---|
| rAF 虚拟时间轴 | 必须替换页面自己的 `requestAnimationFrame` |
| 定时器缩放 | 必须替换页面自己的 `setTimeout` / `setInterval` |

这两个函数是页面全局的，隔离世界改不到——这正是降级引擎的能力边界，
也是悬浮面板在降级模式下显示黄字提示的原因。

## 5. 悬浮控制器的定位模型

这块踩过坑，值得记下来。

**错误实现**：宿主 `div` 同时设 `left/right/top/bottom` 且不设宽高。
浏览器会按「四边拉伸」解析，宿主被拉成 `70×0` 的畸形盒子，控件位置随视口漂移。

**正确实现**：宿主是一个 `0×0` 的 `position:fixed` 纯锚点，不承载任何尺寸；
shadow 里的 `.wrap` 用 `absolute + right/bottom` 贴住锚点：

```css
.wrap { position:absolute; right:0; bottom:0; display:flex; flex-direction:column;
        align-items:flex-end; gap:8px; }
```

于是**锚点坐标 = 控件的「右边缘 / 胶囊底边缘」**。面板展开收起时胶囊停在原地，
不会跳。上方空间不足时加 `.down` 类把面板翻到胶囊下方。

> 教训：这个 bug 在截图里「看不见控件」出现过两次，一次是被 420px 的截图裁掉，
> 一次是真的定位错了。涉及几何的改动必须用探针核对实际值——
> `tools/verify/float.html` 就是为此存在的。

## 6. 配置模型

```
chrome.storage.local['turboSettings'] = {
  global: { …DEFAULTS, speed, enabled },
  sites:  { 'https://example.com': { …覆盖字段 } }
}
```

- 站点键用 `location.origin`（`file://` 页面退化为 `file://`）。
- 主世界启动时同步读 `localStorage['__turboCache']`，**刷新页面零延迟生效**，
  不必等 `chrome.storage` 的异步回调。
- 配置流向：popup / 悬浮控制器 / 快捷键 → `chrome.storage` →
  `chrome.storage.onChanged` → `content.js` → `postMessage` 给主世界。

新增配置项要同步改四处，`CONTRIBUTING.md` 里有清单。

## 7. 打包

`tools/build.js` 不依赖任何第三方库：

- **ZIP**：`zlib.deflateRawSync` + 手写 local file header / central directory / EOCD，
  UTF-8 名称标志位 `0x0800`。
- **CRX3**：Node `crypto` 生成 RSA-2048 私钥，按规范对
  `"CRX3 SignedData\0" + u32le(len(signed_header_data)) + signed_header_data + zip`
  做 RSA-SHA256 签名；扩展 ID 为公钥 SHA-256 前 16 字节按 nibble 映射到 `a-p`。

产物输出到 `dist/`。**签名私钥 `tools/.crx-key.pem` 决定扩展 ID，
已列入 `.gitignore`，丢失或更换都会让已安装用户需要卸载重装。**

## 8. 兼容性红线

改动前必读，两条都踩过：

1. `minimum_chrome_version` 只能往下调。抬到 111 会让狐猴等老内核直接拒绝加载。
2. `content_scripts` 里禁止使用 `world: "MAIN"`，理由见第 2 节。

## 9. 测试策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| 引擎行为 | `tools/engine.test.js`，Node + `vm` 模拟浏览器 | 时间轴数学、定时器链式调度、动画恢复、媒体钳制、非法参数、消息通道 |
| 真实加速比 | `tools/verify/index.html`，无头 Chromium | 设 4x 实测 3.98x；`setInterval` 触发次数；动画 `playbackRate` |
| 端到端注入 | `tools/verify/e2e.html` + `--load-extension` | 扩展加载、主世界注入、桥接缓存 |
| CSP 场景 | `tools/verify/csp.html` + `tools/csp_server.py` | 严格 CSP 下的注入路径与降级效果 |
| UI 几何 | `tools/verify/float.html` | 悬浮控制器锚点与胶囊的实际 `getBoundingClientRect()` |

`vm` 沙箱里 `window` 的自引用身份与宿主侧引用不同，所以测 `postMessage`
必须由沙箱内部构造事件对象——这是 `tools/engine.test.js` 里一个不直观但必要的细节。
