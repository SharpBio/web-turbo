# 参与贡献 Turbo Web

感谢你愿意为 Turbo Web 出力。这个项目会改写页面的全局函数，**正确性比功能数量更重要**，
所以下面的协作约定请先读一遍。

## 环境要求

| 用途 | 要求 |
|---|---|
| 跑单元测试、打包 | Node 18+ |
| 跑浏览器端验证 | 本机有 Chromium 系浏览器 + Python 3 |

运行时不依赖任何 npm 包，仓库里也没有 `package.json`——这是刻意的：
一个浏览器扩展不该让贡献者先 `npm install`。

```bash
node tools/engine.test.js     # 27 项断言，改引擎后必跑
node tools/build.js           # 产出 dist/ 下的 zip 与 crx
```

## 一条硬纪律：新增劫持点必须先写测试

引擎（`src/inject.js`）里每一处 `window.xxx = function ...` 都是一个劫持点，
它们直接影响所有网页的行为。新增劫持点时：

1. **先在 `tools/engine.test.js` 里写失败用例**，再写实现；
2. 用例要覆盖**关闭该功能时能恢复原状**——我们劫持的是共享全局，恢复路径和劫持路径一样重要；
3. 涉及倍率边界（0、负数、非数字、`Infinity`）必须有用例。

```
[4] 定时器：延迟被压缩
  ✓ 2x 时 200ms 延时 → 100ms
  ✓ 1x 时保持 200ms
  ✓ timers:false 时不缩放间隔
  ✓ delay=0 原样透传
```

上面这组就是范本：正常路径、边界、开关回退各一条。

## 代码约定

- **纯标准库**。不引入构建步骤、不引入依赖，`src/` 下的文件必须能直接被浏览器当脚本加载。
- **注释解释「为什么」**，不复述「做了什么」。上面这种取舍说明尤其要留：
  > 为什么不用 `world: "MAIN"`：该字段是 Chrome 111 才支持的……
- **兼容性红线**：`minimum_chrome_version` 只能往下调，不能往上调；
  `content_scripts` 里禁止使用 `world: "MAIN"`（老内核会直接拒绝加载扩展）。
  原因见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#兼容性取舍)。
- **新增配置项**要同步改四处：`src/shared.js` 的 `DEFAULTS`、`src/inject.js` 的 `DEFAULTS`、
  `popup/popup.html` 的开关、`popup/popup.js` 的 `TOGGLE_KEYS`。
- 改完 UI / 几何相关的东西，**必须用探针或截图核对实际渲染结果**，
  不能只看代码逻辑——这个项目里已经因为「逻辑上应该没问题」错过两次。

## 提交信息

用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 支持 SMIL 动画加速
fix: 修复悬浮控制器锚点被拉伸导致的位置漂移
docs: 补充注入机制的三级保障说明
test: 补充倍率为 0 时的媒体钳制用例
```

`feat` / `fix` 会进 [CHANGELOG.md](CHANGELOG.md)，所以请把用户可感知的变化写清楚。

## Pull Request 检查清单

- [ ] `node tools/engine.test.js` 全绿
- [ ] `node --check` 所有改动的 `.js`
- [ ] 新增劫持点有对应测试，且覆盖了「关闭后恢复」
- [ ] 改动了注入机制的话，附上浏览器端验证结果（`tools/verify/*.html` 的输出）
- [ ] 需要用户知情的行为变化，已更新 README / CHANGELOG
- [ ] **没有提交任何密钥、签名材料或本机路径**（见下）

## 敏感信息

`tools/.crx-key.pem` 决定扩展 ID，已列入 `.gitignore`。请永远不要提交、不要分享它。
提交前可以这样自查：

```bash
git status --porcelain          # 不应出现 .pem
git diff --cached | grep -i "BEGIN PRIVATE KEY"   # 应无输出
```

## 行为准则

参与本项目即表示你同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
