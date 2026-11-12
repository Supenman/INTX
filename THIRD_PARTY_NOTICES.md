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

## 2026-11-12：新增 v2.2.1 参考记录（未移植代码）

以上 v2.2.0 来源、独立实现及“不搬”记录保留不变。文中的 `/workspace/beeftv-ref/BeefTV-2.2.0` 和 `/workspace/BeefTV-源码精读-对照清单.md` 是历史环境路径，本轮未据此重新核验；218/57 等统计也不作为 v2.2.1 的统计。

本轮只读参考副本为 `E:\Claude\Projects\BeefTV-2.2.1`，用于制定 INTX 的整体对标路线，**未将该版本代码、素材或运行时加入 INTX**。副本不在 INTX 仓库内、不参与构建；该副本没有 Git 历史，不能仅据此判定混合文件中的历史 MIT 片段。

核对依据为该副本的 `LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md`：

- Part A §3 允许个人使用、学习、研究、复制和私有修改；当前个人本地用途不等于必须另取商业授权。
- Part A §7 要求保留适用的版权和许可通知，不得声称官方背书；使用 INTX 自有品牌。
- 历史 MIT 材料保留其原许可；新增 Covered Material 与第三方依赖、字体、模型、媒体须分别核对，不将整仓视为 MIT。
- 后续若分发修改版，须核对 §4；若涉及 §5 的收费交付或对外服务（包括免费服务），须重新审核适用授权。个人使用许可不能自动扩大到这些用途。

本轮借鉴的是协议适配、提交证据、任务输出身份、原子落盘与下载恢复等设计边界，而非移植清单。后续确需采用代码时，再记录具体文件、版本、修改及适用许可，随采用内容保留必要通知。

路线和本机验证状态见 [INTX 对标与复用路线](docs/reference-roadmap.md)。
