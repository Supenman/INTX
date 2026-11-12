# INTX 对标与复用路线

## 目标与范围

INTX 是主项目，BeefTV 2.2.1 是只读参考；当前目标为个人本地使用，不是复制 BeefTV 全部功能。本路线优先减少重复实现和维护成本。

保留 React / React Flow / Zustand / Tauri 架构。第一阶段只核实基线和整理文档；新增业务功能另行确定范围。不因参考项目使用 Go/Wails、Node sidecar 或另一套 UI 库而引入它们。

## 现状与处置

以下“已有”指源码存在；运行验证状态见后文。

| 能力 | INTX 现状与证据 | 处置 |
|---|---|---|
| 画布交互 | React Flow；`src/ui/canvas/Canvas.tsx` | 保留；先用现有库和 CSS，不复制画布引擎、层级或空间索引 |
| 图片/分镜生成 | `src/app/useCases/runGeneration.ts`：输入校验、任务跟踪、哈希去重、resume 补缺 | 扩展已有链路，不另造调度器 |
| 失败与重发 | `src/domain/task/outcome.ts`：`readTaskOutcome` 三态 | 已借鉴 v2.2.0，不重复移植；需要时区分原结果取回与重新生成 |
| 渠道接入 | `src/infra/provider/index.ts`：`adapterFor` / `registerAdapter` | 一次接通一个真实协议，不预建加权路由平台 |
| 素材与宿主存储 | `src/infra/runtime/index.ts`：`resolveRuntime`；浏览器/桌面分别装配 providers、blobs、tasks | 复用现有边界，先验可靠性，再按需求补原子保存或恢复 |
| 项目管理 | `src/infra/repository/projectRepository.ts`：已有 `ProjectRepository`，当前快照固定 default ID，现有实现为 IndexedDB | 有需求再贯通多项目身份，不重建仓库契约 |
| 视频生成 | 有类型和界面入口，未见完整独立真实流程 | 按需单独接通一个渠道的提交、查询、下载和保存 |
| 图片放大 | 重采样已有，Rust ONNX 推理未完成 | 不混称 AI 超分；需求确定再验证模型与运行库 |
| 助手与插件 | `src/domain/node/registry.ts`、`src/domain/tool/registry.ts` 已有扩展点 | 不等于完整助手/插件平台；暂缓，不搬整个 agent-host |

## 复用决策顺序

1. 查 INTX 已有实现、测试及历史“不搬”决策。
2. 查现有依赖原生能力：React Flow、CSS、Tauri 等。
3. 有明确缺口再评估成熟上游库，核对维护、许可、体积与宿主兼容性。
4. 有真实调用点再小范围借鉴/移植 BeefTV；优先参考行为和测试场景，适配 INTX 类型，不带入其 store、UI 和服务体系。
5. 上述均不适用才自行实现，并记录原因。

每项只记：**需求 → 已有实现 → 来源/版本 → 取舍原因 → 调用点 → 验收场景**。没有调用点不搬代码，不以搬入文件数衡量进度。

延续 [第三方来源说明](../THIRD_PARTY_NOTICES.md) 的既有决策：不重复移植任务三态，不搬已有 `parseGrid` / `gridLayout` 能完成的网格算法，不把 CSS 尺寸逻辑搬成 JS，不提前增加空间索引或独立层级管理。

## 可参考的边界，而非待复制清单

以下路径相对于 BeefTV 2.2.1：

- `backend/internal/protocol/adapter.go`：创建、解析、查询和取消的协议边界；宿主负责凭据与持久化。
- `web/src/lib/task-outcome.ts`、`backend/internal/task/outcome.go`：提交证据、结果可用性和重发策略；不直接套用它独有的恢复 API。
- `backend/internal/task/delivery.go`：稳定的任务输出身份。
- `backend/internal/asset/file_store.go`：临时文件和原子替换。
- `backend/internal/generation/video_download_resume.go`：下载恢复、跨源凭据处理。
- `web/src/lib/channel-url.ts`、`web/src/lib/canvas/video-crop-geometry.ts`：仅在实际出现 URL 拼接或视频裁切需求时评估。

个人使用可按其适用许可复制和私有修改，但仍须核对第三方内容并保留声明。未来对外分发或提供服务时重新审查。INTX 保持自有品牌，不整包搬入媒体、字体、模型或二进制。

## 阶段与进入条件

### 1. 基线与文档（已完成，见文末基线记录）

记录 Git/环境、检查可执行性、运行不需要下载的检查；缺依赖就明确记录阻塞，不自动安装、不顺带修业务代码。维护本路线与来源增量记录。

### 2. 一个端到端增量（另行选定）

优先根据真实使用痛点决定；默认建议先保证现有图片/分镜闭环可靠，而非同时展开视频、助手、多项目。

新增能力沿既有 adapter → use case → runtime/repository 链路接入；节点/工具用 registry。交付必须覆盖入口、执行、保存、重新打开及失败处理，而非只加按钮。真实 API 请求需事先确认渠道、凭据使用和费用。

### 3. 按需扩展（非全量承诺）

- 视频：单渠道端到端；区分本地取消和上游取消，不承诺取消就未计费。
- 多项目：沿已有 repository 贯通项目身份。
- 本地超分：先验证模型许可、资源和打包。
- 助手：先定义受控业务命令，再评估运行时；不绕过业务用例直接改 store。
- 性能：出现可复现瓶颈后测量，不先搬索引。

## 基线记录：2026-11-12

检查基于 Git HEAD `eeee760`，未提交任何更改。开始前已有 `e2e/resolve-chromium.sh` 文件模式 `100755 → 100644` 的变化，未修改或恢复它。

第一轮基线时缺 pnpm 和前端依赖，Rust 离线检查被缓存版本阻塞；随后经确认补齐环境（corepack 提供 pnpm 10.28.2，`pnpm install --frozen-lockfile` 安装依赖，Cargo 按锁文件拉取依赖），全量验证结果如下。

| 检查 | 结果 |
|---|---|
| Node / pnpm | `v24.15.0` / `10.28.2`（corepack，与 packageManager 声明一致） |
| Rust / Cargo | `1.97.1`，满足最低 1.90 |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm test` | **42 个文件 / 483 个用例全部通过** |
| `pnpm budget` | 通过：89 个源码文件 / 14785 行，最大文件 783 行，超 800 行 0 个 |
| 领域层依赖扫描 | 通过，0 处违规；脚本在 Windows 上用 `startsWith('src/domain/')` 匹配 `relative()` 路径含反斜杠，**对 domain 目录可能漏扫**，本轮未改脚本 |
| `pnpm build` | 通过：143 个模块，产物约 625 kB（gzip 约 192 kB） |
| `pnpm e2e` | **13/13 组通过**（Chrome 由 `CHROMIUM_PATH` 指定本机路径），含生成闭环、恢复导入导出、200 节点压力、素材编辑、三态重发、分镜补格交付等；控制台错误 0 |
| `pnpm tauri:check` | 通过：Tauri 2.12.5 按锁文件编译，1m00s |
| Tauri 桌面实机验收 | 未执行：文件存储路径、窗口行为需 `tauri:dev`/`tauri:build` 实机另测 |

所有验证在业务源码零改动下通过；未提交任何更改，未访问真实模型服务。Windows 下运行 e2e 需设置 `CHROMIUM_PATH` 指向本机 Chrome（项目脚本候选列表只含 Linux/macOS 路径）。

### 已知限制

- 领域层扫描的 Windows 路径问题：如需完全覆盖，后续单独修脚本（路径分隔符归一化），不属于本轮范围。
- `pnpm verify` 复合脚本内部调用 `pnpm`，在 shim 未进 PATH 的 shell 里会失败；本轮按其组成逐条执行，语义一致。

共同回归场景：文字/素材 → Mock 分镜生成 → 预览 → 刷新恢复 → 导出/导入；部分成功保留产物，只补缺格；提交不确定不静默重发；保存失败不自动重新购买；项目包和日志不包含凭据。未实现的视频/原任务恢复在对应阶段再验，不冒充已有能力。
