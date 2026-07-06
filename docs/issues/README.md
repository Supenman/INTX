# Issue 状态

本目录以 Markdown 文件管理 issue。`/triage` 会通过 frontmatter 中的 `state` 和 `category` 字段跟踪 issue 状态。

## State Roles（状态机）

| state | 含义 |
| --- | --- |
| `needs-triage` | 新建 issue，尚未分类 |
| `needs-info` | 等待提交者补充信息 |
| `ready-for-agent` | 已经过 grill，agent 可以直接动手 |
| `ready-for-human` | 需要人类判断/动手 |
| `wontfix` | 已确认不做 |

## Category Roles

| category | 含义 |
| --- | --- |
| `bug` | 缺陷 |
| `enhancement` | 体验改进或新功能 |
| `task` | 维护/重构/工程改进 |

## 外部 PR

本项目接受外部 Pull Request。任何由 `ready-for-agent` 类别派生的分支，在合并前应至少有一次人类评审。
