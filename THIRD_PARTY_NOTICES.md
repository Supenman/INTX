# 第三方来源与许可证声明

INTX 的部分设计判断参考了 BeefTV v2.2.0 源码。按许可证 §7 保留版权与许可证声明，并明确：**INTX 不是 BeefTV 的官方版本，也未获其背书**。

## 来源

| 项 | 内容 |
|---|---|
| 项目 | BeefTV v2.2.0 |
| 本地只读副本 | `/workspace/beeftv-ref/BeefTV-2.2.0`（不参与构建、不进 git） |
| 版权 | Copyright (c) 2026 @beefnoode and BeefTV contributors |
| 许可证 | BeefTV Source Available License 1.0，**Part A §3**：内部工作可 use / copy / modify，可 self-host，私有修改无需公开 |
| 红线 | 对外销售、白标、对外提供 API 服务（INTX 均不涉及） |

完整许可证文本见本地副本 `LICENSE`。本仓库不分发 BeefTV 源码，只保留判断逻辑的独立实现与出处。

## 已移植的判断

| INTX 文件 | 来源模块 | 移植了什么 | 没搬什么 |
|---|---|---|---|
| `src/domain/task/outcome.ts` | `web/src/lib/task-outcome.ts`（494 行，零 import） | `regenerate: allowed / confirm / blocked` 三态判定骨架、错误码分档与优先级 | 中文展示文案（`TaskOutcomeCopy`）、节点元数据回退（`CanvasNodeOutcomeMetadata`）、`retrievable` 阶段与 `/recover` 免费取回 |

`outcome.ts` 是**按 INTX 的 Task 模型独立重写**的，不是逐行复制：输入字段、错误码集合、阶段划分都不同——它没有 `local_save_failed`，我们有；它有后端 `/recover`，我们没有，所以「提交不确定」在 INTX 落到 `confirm`（人去厂商后台确认后重发），而不是 `blocked`。展示文案另放 `src/ui/canvas/outcomeCopy.ts`，避免判定逻辑和文案混在一起。

## 明确不搬（已逐个核实）

| 模块 | 理由 |
|---|---|
| `canvas-grid-split.ts`（49 行） | INTX 已有 `domain/node/grid.ts` 的 `parseGrid` / `gridLayout`，且带 16 格上限保护，功能重叠 |
| `canvas-prompt-editor-size.ts`（12 行） | 现有 CSS `min()` / `max()` 已等价，搬进 JS 是把样式逻辑搬进运行时 |
| `canvas-spatial-index.ts`（123 行） | React Flow 12 自带视口裁剪；INTX 当前没有按矩形查节点的调用点，等 500 节点 LOD 那轮再评估 |
| `canvas-node-stack-order.ts`（25 行） | React Flow 自行管理节点 z-index 与绘制顺序 |
| Excalidraw 画布层、Go + SQLite 后端、antd + Tailwind、插件与账号体系 | 采用即换架构，与「无后端 + React Flow」互斥 |

`web/src/lib/canvas` 218 个非测试文件里有 **50 个零 import、7 个仅相对依赖**，共 57 个可低改动复用。逐个处置记录见 `/workspace/BeefTV-源码精读-对照清单.md` 第 9 节。

**判断原则**：没有真实调用点就不搬。把零依赖模块成批拷进仓库只会得到死代码，还要占结构预算。
