# 第三方来源声明

## infinite-canvas v0.20.0（本仓库基座）

- 来源：`basketikun/infinite-canvas` 上游 v0.20.0，作为新基线整树导入（基线提交 `06190b1`）
- 许可：MIT，Copyright (c) 2026 basketikun，原文见仓库根 `LICENSE`
- 约定：按 MIT 要求在衍生副本中保留上述版权与许可声明。上游 README 的二次开发请求（保留原作者信息与前端页面标识）在对外分发前处理。

## INTX（内部项目，本仓库嫁接来源）

- 来源：内部项目 INTX（交接包 2026-11-13，HEAD `8625547`）
- 许可：内部自研，无第三方权利负担
- 嫁接内容：`web/src/domain/`（任务状态机、三态重发判定、审计台账、成本估算、提供商契约）——按「纯函数、零 IO」纪律编写，独立于原 React Flow 前端
- 原仓库保留作 domain 核心来源，不再作为产品主线开发

## BeefTV（仅设计参考，禁止代码复制）

- 来源：`glanderness/BeefTV` v2.2.1（本地参考副本）
- 许可：Source Available License 1.0（Part A 覆盖其新增原创内容）
- 约定：**只参考设计与行为边界（任务三态、提交证据语义、协议分层），不复制任何代码**。历史 MIT 片段与 Part A 新增片段在同文件中混合，无法逐段切分，一律按不可复制处理。

## OpenDirector v0.1.4（Apache-2.0，可复制修改）

- 来源：`OpenDirector` v0.1.4（用户提供的 `OpenDirector-main` 源码包，2026-11-16）
- 许可：Apache License 2.0，Copyright (c) 2026 ThinkFlowLab and the OpenDirector contributors
- 已移植部分：
  - `web/src/lib/canvas/image-presets.ts`：图片预设（人物三视图 / 面部三视图 / 产品三视图 / 连续分镜图 / 多机位）。来源为 `packages/core/src/opendirector/application/tool_image_edits.py` 的 `PRESETS` 与 `image_presets()`。
  - `web/src/services/generation` 与 `web/src/stores/use-config-store.ts` 的渠道 `proxyMode`：行为参考 `src/backend/models.ts`，为独立实现（未复制源码）。
- 修改说明（Apache-2.0 §4(b)）：
  - 预设从 Python 元组改成「静态尺寸 + i18n 语言键」两段式，中英双语；指令文本按原意翻译，不逐字照搬。
  - 尺寸沿用 INTX 的 `size` 像素串，不调用上游 `reframe`；生成链路改走 `requestSingleImage`（含任务三态与台账）。
  - 五个预设的产出张数与原实现一致（三视图各 1 张，分镜与多机位各 4 张）。
- 未移植：`src/canvas/TimelineEditor.tsx`、`timeline*.ts`（M4 计划项）；`AssistantPanel` 系列（M3 计划项）。这些尚未开始，落地时按同一规则登记。
- 上游对 mediabunny 的依赖为 MPL-2.0，本项目尚未引入；引入时按「不改源码、从 npm 原样消费」处理。

## 维护规则

- 从 infinite-canvas 后续版本同步代码时，更新本文件的版本记录
- 新增第三方依赖时在此追加条目
- 任何「参考后独立实现」的模块，在本文件记录参考来源与实现差异说明，不以自述代替可核查依据
