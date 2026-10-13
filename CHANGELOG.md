# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 计划中
- Firefox 支持（MV3 注入机制差异较大）
- 倍率面板支持自定义输入具体数值
- 演示页增加可对比的「未加速」对照组

## [1.1.0] - 2026-10-12

### 新增
- **安卓兼容**：弃用 `content_scripts[].world: "MAIN"`（Chrome 111+ 才支持），
  改为隔离世界插入 `<script>` 把引擎送进页面主世界，`minimum_chrome_version`
  降至 `"88"`。狐猴浏览器（Chromium 107）等老内核可正常加载。
- **页面内悬浮控制器**（`src/floating.js`）：手机端没有工具栏图标也点不到 popup，
  在每个页面右下角放置胶囊，点开可微调、选档、暂停、隐藏，可拖动且位置按站点记忆。
- **隔离世界降级引擎**（`src/fallback.js`）：主世界注入失败时只依赖 DOM 加速
  CSS 动画 / 过渡 / WAAPI / 视频音频 / SVG SMIL，不受站点 CSP 影响。
- **自签 CRX3 打包**（`tools/build.js`）：产出 `dist/web-turbo-<ver>.crx`，
  供安卓狐猴浏览器「安装本地扩展」一步装好。私钥 `tools/.crx-key.pem` 已列入
  `.gitignore`。
- **严格 CSP 测试服务器**（`tools/csp_server.py`）与验证页 `tools/verify/csp.html`。
- **悬浮控制器几何探针**（`tools/verify/float.html`）。
- 文档：README、LICENSE、CONTRIBUTING、CODE_OF_CONDUCT、SECURITY、CHANGELOG、
  `docs/ARCHITECTURE.md`、GitHub Issue/PR 模板与 CI。

### 修复
- 悬浮控制器宿主元素同时设置 `left/right/top/bottom` 且无宽高，被浏览器拉成
  `70×0` 的畸形盒子，导致控件位置随视口漂移。改为 `0×0` 固定锚点 +
  shadow 内 `right/bottom` 贴合，胶囊位置不再随展开收起跳动。
- 注入失败判定原先只看「就绪标记是否出现」，外链脚本异步加载时会被误判为失败。
  改为结合 `error` 事件 + 分级等待窗口。

### 变更
- 打包产物从仓库上级目录改为输出到 `dist/`。

## [1.0.0] - 2026-10-12

首个可用版本。

### 新增
- 虚拟时间轴：劫持 `requestAnimationFrame` + `performance.now`，双锚点换算，
  变速瞬间时间连续不跳变。
- `setTimeout` 缩放延迟；`setInterval` 改为负数 id 的链式 `setTimeout` 调度，
  倍率变化对已在运行的间隔立即生效。
- `document.getAnimations()` 巡检 + MutationObserver + `animationstart` /
  `transitionstart` / `play` 事件补齐，统一设置 `playbackRate`。
- `video` / `audio` 的 `playbackRate`（钳制 16x）与 `preservesPitch`。
- 可选项：SVG SMIL、`Date.now` 劫持、逐帧重复模式。
- 配置模型 `{ global, sites }`，支持按站点分别记忆与「本站禁用」。
- 快捷键：`Alt+.` 加快、`Alt+,` 减慢、`Alt+X` 暂停、`Alt+Shift+X` 复位。
- 控制面板：对数刻度滑块、档位预设、加速范围逐项开关。
- 单元测试 `tools/engine.test.js`（27 项断言）与浏览器端验证页
  `tools/verify/index.html`、`tools/verify/e2e.html`。

[未发布]: https://github.com/YOUR_USERNAME/web-turbo/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/YOUR_USERNAME/web-turbo/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/YOUR_USERNAME/web-turbo/releases/tag/v1.0.0
