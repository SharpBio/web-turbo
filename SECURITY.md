# 安全政策

## 这个项目为什么需要单独一份安全说明

Turbo Web 会在**每一个网页**里改写全局函数（`requestAnimationFrame`、
`performance.now`、`setTimeout`、`setInterval`、`Date.now`）。这意味着
一旦实现有缺陷，影响面不是单个站点，而是用户访问过的所有站点。
所以我们把安全边界写在这里，请你报告问题时也按这个框架描述。

## 我们明确做的事

- 劫持页面主世界的时间相关全局函数，用于缩放动画与定时器
- 读写 `chrome.storage.local`（扩展自身的配置）与页面 `localStorage`
  的一个键 `__turboCache`（用于刷新后零延迟生效）
- 在页面里插入一个 Shadow DOM 悬浮控制器
- 向扩展后台发送当前倍率，用于更新工具栏徽标

## 我们明确不做的事

- **不收集、不上传任何数据**。没有任何网络请求发往扩展作者或第三方服务器
- 不读取页面内容、表单、Cookie、登录态
- 不注入除 `src/inject.js` 之外的脚本
- 不使用 `eval` / `new Function`
- 不申请 `tabs`、`history`、`cookies`、`webRequest` 等敏感权限
  （当前仅 `storage` + `activeTab`）

## 已知的高风险面（已知取舍，非漏洞）

| 项 | 说明 | 缓解 |
|---|---|---|
| `Date.now` 劫持 | 会打乱依赖系统时间的业务逻辑，可能触发站点风控 | 默认关闭，需用户在高级选项手动开启 |
| 逐帧重复模式 | 同一帧内多次派发回调，可能让页面逻辑过量执行 | 默认关闭 |
| 定时器缩放 | 倒计时、防抖、轮询逻辑会被同步压缩 | 提供「本站禁用」与逐项开关 |
| 媒体 `playbackRate` | DRM 或站点锁定的媒体可能抛错 | 已用 try/catch 包裹并忽略 |

如果你认为上述某项在特定场景下造成了实际危害，那仍然值得报告——
我们想了解真实影响，而不只是理论风险。

## 报告安全问题

**请不要通过公开 issue 报告安全问题。**

1. 使用 GitHub 的
   [Private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities)
   私下提交（推荐）；若仓库未开启该功能，请发起一个仅维护者可见的
   security advisory 草稿，或在 issue 中说明「有安全问题要报告，请私下联系」而不要描述细节。
2. 报告请包含：受影响的文件与行号、复现步骤、影响范围（哪些站点 / 哪些内核版本）、
   你建议的修复方向。
3. 我们会在 **7 个自然日**内确认收到，并在 **90 天内**给出修复或明确的处理结论。

## 签名密钥

`tools/.crx-key.pem` 是 CRX 签名私钥，已列入 `.gitignore`。
它**不属于**本项目需要报告的资产（不在版本库中），但如果你发现自己
不慎把它提交到了某个公开仓库，请视同泄露处理：重新生成一把，
并提醒已安装用户卸载后重装（扩展 ID 会变）。
