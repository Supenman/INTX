# ADR 0001 — 使用本地 Markdown 文件管理 issue

## 状态

已接受 — 2026-06-29

## 背景

项目需要为 `/triage` 之类的工程 skill 提供一个 issue 追踪器。当前沙箱到 GitHub 的网络访问不稳定，配置 GitHub PAT 在本地 dev 流程中也较重。Linear 当前未在用。

## 决策

- 使用本地 Markdown 文件存放在 `docs/issues/`，通过 frontmatter 跟踪 `state` 和 `category`。
- 模板使用 `_template-*.md` 命名，下划线前缀让它们在目录排序时排在前面。

## 后果

- 优点：无需外部依赖；可以随 git 一起版本管理；`/triage` 读取 frontmatter 即可。
- 缺点：不能像 GitHub Issues 一样支持多用户协作；需自建简单的状态/标签约定。
- 后续：如切换到 GitHub Issues，只需在 `docs/issues/` 上方加一层映射脚本。
