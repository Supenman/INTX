# BeastTV React — 项目上下文

> 由 `/grill-with-docs` 维护。任何对领域术语、目标用户、关键约束的修改，请同步更新本文件。

## 一句话定义

BeastTV 是一个基于 React Flow 的可视化 AI 内容创作平台，支持在无限画布上连接文本、图片、视频三类节点。

## 核心用户

- 视频/影视创作者：希望像搭乐高一样规划分镜、生成关键帧、串成成片。
- AI 工作流爱好者：希望可视化地搭建多模型协作流程。

## 关键术语

| 术语 | 含义 |
| --- | --- |
| 节点 (Node) | 画布上代表一次生成任务的卡片，分为 image / text / video 三类 |
| 画布 (Canvas) | 基于 `@xyflow/react` 的无限工作区 |
| 抽屉 (Drawer) | 节点激活后展开的属性编辑面板 |
| 源/目标连接 | 从 source 节点向 target 节点传递 prompt 或生成结果 |
| 生成任务 (Task) | 后端异步执行的生成单元，状态流转 `queued → running → succeeded/failed` |
| 引用 (Reference) | 在 prompt 中用 `@node_id:index` 语法引用上游节点的历史输出 |
| model → provider 映射 | 模型名称到 API 平台的对应关系，由 `api_providers.json` 中的模型列表决定 |

## 主要约束

- **离线优先**：本仓库不依赖云端服务就能完成 UI 开发、UI 评审。
- **后端契约**：前端假设后端服务在 `http://127.0.0.1:8000`，所有 API 通过 fetch 调用。
- **依赖外部 API Key**：实际生成需要用户在 API 设置里配置 ModelScope 等平台的 key。
- **接受外部 PR**：但所有改动需要通过现有 lint/build 检查。

## 当前阶段

- v0 UI 已完成首轮视觉优化（暗色信号色主题、节点卡片重构、添加节点面板改造）。
- 启动脚本 `start-beasttv.bat` / `stop-beasttv.bat` 已就绪。
- ESLint 9 配置已落地，lint 0 错 0 警。
- **阶段一（进行中）**：核心生成闭环——异步任务系统、本地存图、轮询进度、`@` 引用上游资产、image/text/video 三种类型覆盖。
- 架构决策记录（ADR）已扩展至 0006：异步任务、provider_id 传参、本地媒体存储、节点连接语义。

## NODE_TYPE_REGISTRY 范围

为消除节点元数据在 BaseNode / NodeDrawer / NodeTypeMenu 三处的重复，建立 `src/domain/nodeTypes.js`，导出 `NODE_TYPE_REGISTRY`（`Object.freeze` 平面字典）。已达成共识：

- 类型集合冻结为 image / text / video，不预留插件接口。
- Registry 只含纯数据（id、label、accent、icon、placeholder、emptyHint、drawerTitle、labelEyebrow 等），不含派生规则。
- `ASPECT_RATIOS` / `RESOLUTIONS` 放 `src/utils/dimensions.js`，与 registry 解耦。
- 后端字段名 `image_models` / `chat_models` / `video_models` 与 registry id 的映射放 `src/utils/modelUtils.js`。
- Registry 不引入测试。
- 字段集：`id, label, drawerTitle, accentVar, accentRgb, eyebrow, icon (JSX), smallIcon (JSX), emptyHint`。
- Registry 中 icon / smallIcon 是 JSX（ReactNode），不是字符串。
- 本次重构只动 registry 与三处元数据消费点；NodeDrawer 内联的 `MenuButton` / 悬空的 `<DropdownMenu>` 引用 / `getIcon` / `getTypeLabel` 另开 issue 处理。
- `src/nodeTypes.jsx` 占位文件随本次重构删除。
