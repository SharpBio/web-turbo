# Pull Request

## 改动内容

<!-- 简述这个 PR 做了什么，关联的 issue 编号 -->

Closes #

## 改动类型

- [ ] Bug 修复
- [ ] 新功能
- [ ] 重构（不改变外部行为）
- [ ] 文档
- [ ] 构建 / 工具链

## 自检清单

提交前请确认（详见 CONTRIBUTING.md）：

- [ ] `node tools/engine.test.js` 全部通过（27 项断言）
- [ ] `node --check` 覆盖所有改动的 JS 文件
- [ ] 未提交任何密钥 / 私钥 / 个人信息（`*.pem`、`dist/`、`.crx` 已在 .gitignore 中）
- [ ] 若改了主世界引擎（src/inject.js）的劫持点，新增了对应的测试用例
- [ ] 若改了悬浮控制器几何，已用 `tools/verify/float.html` 实测核对
- [ ] 若改了注入逻辑，已用 `tools/verify/e2e.html` 与 `tools/verify/csp.html` 回归
- [ ] 未引入 `world: "MAIN"`，未抬高 `minimum_chrome_version`（红线见 docs/ARCHITECTURE.md 第 8 节）
- [ ] 需要时更新了 CHANGELOG.md 的 `[Unreleased]` 段

## 验证记录

<!-- 贴关键输出或截图，说明你是怎么验证的 -->
