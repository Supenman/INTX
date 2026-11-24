# INTX × BeefTV 产品结构梳理与渐进改造方案

> 建立时间：2026-11-24
> 参考对象：`glanderness/BeefTV`，默认分支 `main`，`VERSION v2.4.4`，HEAD `a5217dd`（2026-11-23）
> 源码状态：已取得完整工作树（用户提供 zip，并由 GitHub `main` 复核），逐文件只读核对；**未运行**。涉及运行行为、截图、动效的结论仍标「未验证」。
> 许可证边界：BeefTV 为 Source Available Part A，`AGENTS.md:109` 明确**禁止复制代码**。本文只描述结构与交互，不搬运实现。
> 架构约束（沿用）：不整体重写、不改快照 codec 与迁移、不引入第二套状态管理。

---

## 第一部分：BeefTV 产品结构还原

### 1.1 路由与页面（源码：`web/src/router.tsx`）

| 路径 | 页面 | 布局 | 说明 |
|---|---|---|---|
| `/` | `HomePage` | 全壳 | 首页仪表盘 |
| `/create` | `CreatePage` | 外壳 + `is-creation-workspace` | 对话式创作页 |
| `/tasks` | — | — | **重定向 `/`**（源码注释："任务页暂不开放，保留路由以避免旧链接进入半成品界面"） |
| `/assets` | `AssetsPage` | 全壳 | 资产库 |
| `/skills` | `SkillsPage` | 全壳 | 技能市场 |
| `/skill` | — | — | 重定向 `/skills` |
| `/skills/reference` | — | — | 重定向 `/` |
| `/plugins` | `PluginsPage` | 全壳 | 插件中心（`RequireFeature` 开关） |
| `/p/:pluginId`、`/p/:pluginId/*` | 插件宿主页 | 全壳 | 运行时挂载插件页面 |
| `/settings` | `SettingsPage` | 全壳 | 设置页（`?section=channels|storage` 分区直达） |
| `/agents` | `AgentsPage` | 全壳 | MCP / Agent |
| `/projects`、`/project`、`/canvas` | `CanvasPage` | 全壳 | 项目库（三个路径同一页，`/project` 保留原始 URL 以避免闪烁） |
| `/projects/:id`、`/projects/:id/:view`、`/projects/:id/chapters/:chapterId`、`/projects/:id/workflow/:unitId/:stage` | `LocalAwareProjectRoute` | — | 有 `projectId` 时重定向 `/canvas/:id`，否则渲染项目详情 |
| `/project/:projectId`、`/project/:projectId/*` | — | — | 旧路径别名，重定向 `/projects/...` |
| `/canvas/:id` | `CanvasProjectPage` | **隐藏外壳** | 沉浸式画布编辑器 |
| `*` | `NotFound` | — | 404 |

> `createWorkspaceRouter` 来自 `@/lib/app-routing`，本仓库未逐行核对，标「未验证」。

### 1.2 全局外壳（`web/src/layouts/user-layout.tsx` + `components/layout/app-top-nav.tsx`）

- 外壳组件 `AppWorkspaceShell`，左右结构：左侧 `WorkspaceSidebarNav` + 右侧舞台。
- **隐藏外壳规则**：`hideChrome = pathname.startsWith("/admin") || /^\/canvas\/[^/]+/.test(pathname)`。即画布编辑器与管理后台**没有左侧栏**。
- **两套主题**：`isCanvasEditorPath` 决定是否套产品主题（`getWorkspaceAntThemeConfig`），并用 body class 隔离浮层（`app-user-overlays` / `app-spatial-overlays` / `app-product-overlays`）。
- 全局能力：`⌘K / Ctrl+K` 命令面板（`WorkspaceCommandPalette`）、`WorkspaceNoticeStack`（通知栈）、`WorkspaceOperationProgress`（操作进度）、`FirstCreationGuide`（首次创作引导）、`useDesktopUpdateBootstrap`（桌面更新）。
- 侧栏折叠状态持久化：`readWorkspaceSidebarCollapsed` / `writeWorkspaceSidebarCollapsed`；移动端 <1024px 走抽屉。

### 1.3 侧栏导航项（`components/layout/workspace-sidebar-nav.tsx`，`buildNav`）

| 分组 | 项 | 目标 |
|---|---|---|
| 常驻 | 新建项目 `+` | `/canvas?mode=new` |
| 常驻 | 首页 | `/` |
| 常驻 | 项目 | `/project` |
| 常驻 | 资产 | `/assets` |
| 常驻 | 技能 | `/skills` |
| 常驻（feature） | 插件 | `/plugins` |
| 常驻 | BeefTV MCP | `/agents` |
| 常驻 | 模型配置 | `/settings?section=channels` |
| 常驻 | 存储设置 | `/settings?section=storage` |

- 底部：`OnboardingEntry`、社交链接、更新、账户、主题切换。
- **管理/设置/退出不在侧栏底部**，收进用户卡片菜单（源码注释）。

### 1.4 首页（`pages/home/home-dashboard.tsx`）

三段式：
1. **Hero**：一个大号「新建画布创作」按钮 → `/canvas?mode=new`。
2. **能力入口**：`beefTVCapabilityItems`（`home-data.ts`）渐变图标栅格（含 agent，嵌入运行时不显示）。
3. **最近项目**：`slice(0, 4)` 卡片 +「查看全部」→ `/project`；空态是「创建第一个画布」。

> 首页**不直接链到 `/create`**；主新建入口是 `/canvas?mode=new`。`/create` 的可达性需在运行态确认，标「未验证」。

### 1.5 项目库（`pages/canvas/index.tsx`）

- 头部：搜索、导入画布（zip）、回收站、新建文件夹。
- 第一个卡片固定为「开始创作」（`beginLocalCanvasProject("未命名项目")`）。
- 项目卡：打开画布、移动文件夹、复制、导出、删除；文件夹卡支持封面/重命名/导出/删除。
- 支持 `?mode=new|recent|handoff` 自动创建或打开画布（Agent/外部交接用）。
- 无限滚动（每次 +50）。
- 空态：「让第一个想法落在画布上」。

### 1.6 画布（`pages/canvas/project.tsx` + `pages/canvas/use-*`）

- 沉浸式，无左侧栏。
- 内嵌助手侧栏（`canvas-assistant-*`）、生成编排（`use-canvas-generation-*`）、工作流（`use-canvas-workflow-*`）、版本历史（`canvas-version-history.tsx`）、任务确认（`canvas-task-confirmation.ts`）。
- **时间线在画布内**：`use-canvas-timeline-asset-insert.ts`，无独立剪辑台页面。

### 1.7 创建页（`pages/create/*`）

- 对话式创作：`CreationComposer` + 消息流 + 历史抽屉 + 素材库选择器。
- 「继续到画布」：`continueOnCanvas` → 落到 `/canvas/:id`。

### 1.8 四类问题小结

| 问题 | BeefTV 的做法 |
|---|---|
| 导航 | 启动落首页 → 新建项目直达画布（`?mode=new`）；项目与画布用 `/canvas` + `/canvas/:id` 两级；工作区内靠侧栏返回 |
| 布局 | 侧栏常驻（画布/后台隐藏）；资产/技能/插件/Agent/设置都在侧栏一级；命令面板补长尾入口 |
| 任务流 | 生成结果在画布内预览与版本化；素材从资产库/上传进入；归档走画布；**任务页下线**，任务信息留在工作区 |
| 共用交互 | 统一外壳 + 通知栈 + 命令面板 + 空状态组件 + 折叠记忆；焦点恢复在对话/面板内处理 |

---

## 第二部分：INTX 现状（本地源码）

| 维度 | 现状 | 文件 |
|---|---|---|
| 路由 | `/`、`/assets`、`/skills`、`/tasks`、`/canvas`、`/canvas/:id`、`/canvas-flow-pilot`、`/editing-studio`、`/config` | `web/src/router.tsx` |
| 外壳 | 单一 `UserLayout` = `AppTopNav` + `children` + 全局 `AgentPanel` | `layouts/user-layout.tsx` |
| 隐藏侧栏 | `/canvas/:id` 和 `/editing-studio` | `components/layout/app-top-nav.tsx` |
| 导航项 | 首页 + `navigationTools`（canvas / editing-studio / assets / skills / tasks / config） | `constant/navigation-tools.ts` |
| 首页 | Hero 新建 + 7 个快捷入口 + 最近 3 个项目 | `pages/home/index.tsx` |
| 设置 | 独立页 `/config`（Tabs：渠道/模型/存储/任务）+ 桌面端 `ConfigComfyUI` | `pages/config/index.tsx` |
| 画布 | 顶栏已含 首页/项目/新建/删除/导出/导入图片/保存工作流/插入工作流/预览链路/生成历史/分镜/打开剪辑台/插件/撤销重做/Agent | `pages/canvas/project.tsx:3575-3600` |
| 剪辑台 | 独立页，基于 OpenCut（`@/lib/opencut`）：Assets/Properties/Timeline/Preview/Export | `pages/editing-studio/index.tsx` |
| 任务 | 独立只读台账（running/succeeded/ended 分桶，无重发按钮，含核销/证据） | `pages/tasks/index.tsx` |
| 试点页 | `/canvas-flow-pilot` 仅路由可达，无导航入口，注释写明"不接入生产业务" | `pages/canvas-flow-pilot/index.tsx` |

---

## 第三部分：功能归属决策

> 决策口径：**保留 / 调整 / 合并 / 删除**。每项给出场景、依据、涉及文件、验收。

### 3.1 首页、项目与全局导航

| 决策 | **调整**（已落地，不重写） |
|---|---|
| 场景 | 用户启动 → 首页 → 新建/继续 → 画布 → 返回 |
| BeefTV | 侧栏一级项 + 设置拆「模型配置/存储」两个直达；首页三段式 |
| INTX 现状 | 侧栏项来自 `navigationTools`；`/config` 页与顶栏齿轮弹窗共用 `AppConfigPanel` |
| 已做 | ① 侧栏「配置」拆为「模型配置」`/config?tab=channels`、「存储设置」`/config?tab=local-storage`；② `navigationTools` 支持可选 `to`，激活态按 `tab` 区分；③ 设置页读 `?tab=` 作为 `initialTab`，面板内切标签用 `replace` 同步回 URL |
| 未做 | 首页快捷入口与侧栏重复（画布/剪辑台/资产/技能/任务/Agent）。BeefTV 首页同样保留能力栅格，**判定为合理重复，不动** |
| 涉及文件 | `constant/navigation-tools.ts`、`components/layout/app-top-nav.tsx`、`components/layout/app-config-modal.tsx`、`pages/config/index.tsx`、`i18n/locales/{zh-CN,en-US}.ts` |
| 验收 | 从侧栏一次点到模型配置/存储；刷新后停在原分区；面板内切标签后侧栏高亮跟随 |

### 3.2 画布与节点

| 决策 | **保留** |
|---|---|
| 场景 | 节点创建、连线、生成、选择、快捷工具 |
| 依据 | INTX 画布顶栏能力已覆盖并**多于** BeefTV（分镜、生成历史、工作流保存/插入、链路预览、插件）；快捷键已有 Ctrl/Cmd+Z/Y/A/G/C/V（`project.tsx:1885+`） |
| 建议 | 不引入 React Flow / Excalidraw 替换现有画布；`canvas-flow-pilot` 只是手感试点，不接入生产 |
| 验收 | 主流程不回归；快捷键在 1280/1440/1920 可用 |

### 3.3 资产与工作流

| 决策 | **调整**（补入口，不改模型） |
|---|---|
| 场景 | 素材导入 → 生成 → 归档 → 复用 |
| BeefTV | 全局 `/assets` + 画布内素材库选择器；工作流在画布内编辑 |
| INTX 现状 | 已有 `comfy-workflow-editor/import`、画布 `onSaveWorkflow/onInsertWorkflow`、资产库 |
| 建议 | 资产页补「从生成结果归档」的显式入口/状态提示；工作流沿用现有，不新增第二套 |
| 涉及文件 | `pages/assets/index.tsx`、`components/layout/comfy-workflow-*.tsx` |
| 验收 | 生成结果能一键进资产库；工作流导入后能在画布选中 |

### 3.4 Agent、任务与历史

| 决策 | **保留 `/tasks`，不照搬"任务融入画布"** |
|---|---|
| 场景 | 运行状态、结果、失败、历史 |
| BeefTV | `/tasks` 下线，任务信息留在工作区 |
| INTX 现状 | `/tasks` 是只读台账，含核销/证据/排错，是差异化能力 |
| 判断 | INTX 的任务台账不是"半成品"，删了会丢核销与排错能力。**保留独立页**；画布内生成历史（`generationHistoryOpen`）也保留 |
| 可选调整 | 首页快捷里的「任务」与侧栏重复，二选一即可（低优先） |
| 验收 | 任务失败后能从台账定位原因；画布内能开生成历史 |

### 3.5 剪辑台（重点核对项）

| 决策 | **保留剪辑台；不把时间线编辑搬进画布；无可安全删除的大块重复** |
|---|---|
| 场景 | 画布素材 → 剪辑 → 成片 → 回资产库 |
| BeefTV | **无独立剪辑台**，时间线在画布内（`use-canvas-timeline-asset-insert`） |
| INTX 现状 | 剪辑台是 OpenCut 完整编辑器（Timeline/Preview/Properties/Export）；画布只有 `timeline` 数据模型（`domain/timeline/model`）+ 播放头联动高亮 + 「打开剪辑台」入口（`project.tsx:3589`） |
| 核查结论 | 两者**不是重复实现**：画布存时间线数据用于播放联动，剪辑台负责实际编辑。没有"旧画布时间线 UI"可删 |
| 核查（已确认） | 画布顶栏入口是 `onOpenEditingStudio={() => navigate("/editing-studio")}`（`pages/canvas/project.tsx:3589`），**不传项目 id、不传素材**；剪辑台自行从 localforage 读 OpenCut 项目 |
| 建议 | 保留分工；批 2 再补「画布素材 → 剪辑台」的一次性导入入口，不改快照 codec |
| 验收 | 画布素材能进剪辑台；成片能回资产库；画布播放联动不回归 |

### 3.6 设置与全局视觉

| 决策 | **调整** |
|---|---|
| 场景 | 渠道、模型、存储分组；按钮/菜单/面板/间距/状态统一 |
| BeefTV | 独立设置页 + `?section=` 直达；统一外壳与令牌 |
| INTX 现状 | `/config` 页 + Tabs；已有 `docs/视觉基线-BeefTV.md`（色板/阴影/字号/圆角/对比度已对齐） |
| 建议 | ① 设置支持 `?tab=` 直达（配合 3.1）；② 统一空状态/加载/错误组件（已有 `SnapshotStorageStatus`、`PageShell`）；③ 阶段 3 再铺全局视觉，**不在本轮大改样式** |
| 验收 | 两个直达入口可用；浅/深色下设置页一致 |

### 3.7 不引入的能力（明确划界）

| 项 | 决定 | 理由 |
|---|---|---|
| `/create` 对话式创作 | **暂不引入** | 属新功能，非"渐进改造"；INTX 已有 AgentPanel 覆盖部分场景。需产品决策，标「未验证收益」 |
| `/agents` 独立 MCP 页 | **暂不引入** | INTX 的 Agent 是常驻侧栏面板（`AgentPanel`），形态不同，强行加页会分裂入口 |
| `/plugins` 插件中心 | **暂不引入** | INTX 已有 `usePluginHost` 钩子，但未做插件市场；属新功能 |
| 新开源库 | **本轮不建议引入** | 命令面板可用 antd + 现有组件实现；现有画布/剪辑台技术栈已够用。若未来引入，须按任务要求逐项写"换成什么/为何能嵌入/改哪些文件/人日"，当前依据不足，标「未验证」 |

---

## 第四部分：分批落地计划

### 批 1：定产品结构（已落地）

- ✅ 设置拆两个直达入口（`/config?tab=channels`、`/config?tab=local-storage`），URL 与面板内切换双向同步。
- ✅ 首页与侧栏重复入口：核对后**保留**。BeefTV 首页本身也有能力栅格，重复属同一设计语言，删了反而少一个入口。
- ✅ 项目库与画布返回路径核对：画布顶栏 `onHome` → `/`、`onProjects` → `/canvas`（`project.tsx:3583-3584`），已具备。
- **待真机验收**：启动 → 首页 → 新建 → 画布 → 返回 ≤2 次点击；两个设置入口可达且刷新不丢分区。

### 批 2：贯通创作主流程（已落地前两条断点）

路径：打开项目 → 导入素材 → 画布生成 → 查看任务结果 → 归档资产 → 送入剪辑台。

**已消除的断点**

| 断点 | 事实 | 处理 |
|---|---|---|
| 画布素材进不了剪辑台 | 剪辑台「从素材库导入」只读资产库；画布节点只有单个「保存到资产」入口，没有批量归档 | 新增 `application/canvas/canvas-assets.ts`，画布菜单加「归档到资产库」，按 `metadata.nodeId` 去重 |
| 画布→剪辑台无上下文 | `navigate("/editing-studio")` 空跳转，剪辑台打开上次的剪辑项目 | 跳转带 `?from=<画布id>&title=`，素材列表置顶该画布素材，「返回」回到原画布 |
| 首页「最近项目」空态弱 | 空态只有一句提示，没有新建动作 | 空态标题旁补「新建项目」按钮，直接建画布并进入 |

**仍未处理**

- 成片回资产库：剪辑台的导出走 OpenCut `ExportButton`，产物落盘而非资产库。需要考虑“导出即归档”，但 OpenCut 导出结构改动面大，**本轮不动，标「未验证可行性」**。
- 生成结果自动归档：目前归档是显式动作。自动归档会让资产库随生成膨胀，需产品决策。
- 失败任务从台账恢复已在 `/tasks` 具备，无需改。

**验收**：整条路径不断裂；失败任务能在 `/tasks` 定位；归档不产生重复资产。

### 批 3：统一全局视觉与交互（已落地部分）

| 项 | BeefTV | INTX 处理 |
|---|---|---|
| 命令面板 `⌘K` | `workspace-command-palette.tsx`，顶栏注册 `⌘K/Ctrl+K` | 新增 `components/layout/command-palette.tsx`，只收「去哪 / 新建 / 开关 Agent」三类动作；侧栏加搜索入口按钮 |
| 空状态 | 统一组件 + 能力栅格空态 | 抽出 `components/layout/empty-state.tsx`，项目库与资产页改用；修掉 `mt-4/mt-5`、`min-h-280/360` 的跳动 |
| 焦点恢复 | 面板/对话内处理 | 面板用 antd `Modal` + `destroyOnHidden`，关闭即卸载输入框，焦点自然回到触发位置；**未做**显式焦点回填，标「未验证」 |
| 通知栈 | `WorkspaceNoticeStack` | INTX 用 antd `message`，已覆盖反馈场景，**不引入第二套** |
| 视觉令牌 | — | `docs/视觉基线-BeefTV.md` 已对齐色板/字号/圆角，本轮不动样式体系 |

**未做**：全局快捷键表与可视化帮助（`?` 弹窗）；主题切换动效。前者需要先定「哪些键归全局」，属产品决策。

**遗留项已清理（批 4）**：`pages/assets/index.tsx` 曾从 antd 导入 `Empty` 却从未使用（原有死代码），已在批 4 删除该导入。

### 批 4：清理重复并验收

**清理（2026-11-24 已完成）**：

| 项 | 处理 | 依据 |
|---|---|---|
| `components/canvas/canvas-timeline-dialog.tsx`（400 行） | **已删** | 全仓无 import、无 barrel 导出、无测试引用；唯一导出 `CanvasTimelineDialog` 无调用方，画布内也无对应开关状态残留 |
| `pages/assets/index.tsx` 的 antd `Empty` 导入 | **已删（1 行）** | 改动前就未使用，死代码 |
| `pages/canvas/project.tsx` 的 `timeline` 数据 | **保留** | 属快照字段，`project.tsx:55` 等仍在用，删会破坏旧项目 |
| `domain/timeline/*`（7 个文件） | **保留** | 除已删对话框外，persistence、storage、timeline-export、timeline-text、project.tsx 均在使用 |
| `canvas-flow-pilot`（173 行 + 路由） | **隔离保留** | 无导航入口但是 React Flow 手感对比试点，删除会留下 `public/pilot-data` 孤立数据；属产品决策，不擅自删 |

删除后核查：无残留引用、`domain/timeline` 完好、`assets/index.tsx` 语法检查通过。

**验收（交用户真机执行）**：

- 旧项目打开后画布正常（快照兼容）。
- 快捷键回归：⌘Z/Y/A/G/C/V、Delete、Esc 在画布内仍正常，且 ⌘K 不与之冲突（全局监听 vs 画布 keydown）。
- ⌘K 在画布/剪辑台（侧栏隐藏）下能否呼出。
- 画布归档 → 资产页可见 → 剪辑台素材置顶这条链。
- 1280 / 1440 / 1920 宽度下侧栏、命令面板、空状态不错位。
- 浅色 / 深色主题下新组件可读。

> 人日估算：本方案以现有组件拼装为主，无新库引入。批 1 约 0.5–1 人日，批 2 约 1–2 人日（取决于断点数量），批 3 约 1–2 人日，批 4 约 0.5 人日。**依据不足，标「未验证」**，需实际动手后校准。

---

## 第五部分：删除前核查表

| 候选 | 调用/入口 | 快捷键 | 旧项目兼容 | 结论 |
|---|---|---|---|---|
| `/tasks` | 侧栏（navigationTools）+ 首页快捷 + 路由 | 无 | 任务台账数据独立 | **不删**（差异化能力） |
| 画布 `timeline` 数据 | `domain/timeline/model`、`project.tsx` 多处 | 无 | 快照含 timeline，删会破坏旧项目 | **不删** |
| 剪辑台 `/editing-studio` | 侧栏 + 画布入口 | 无 | OpenCut 独立存储 | **不删** |
| `canvas-flow-pilot` | 仅路由，无导航 | 无 | 试点数据在 public | **隔离保留**，删除待产品确认 |
| 首页重复快捷 | 首页 shortcuts | 无 | 无 | **可精简**（低优先） |

---

## 第六部分：未验证清单

1. BeefTV `/create` 在运行态是否从导航可达（首页只链 `/canvas?mode=new`）——**未验证**。
2. BeefTV 命令面板具体条目与快捷键冲突——**未验证**（未运行）。
3. BeefTV 画布内时间线的实际交互与 `use-canvas-timeline-asset-insert` 行为——**未验证**。
4. 各批人日估算——**未验证**。
5. 视觉/截图层面的对齐——**未验证**（沙箱无法运行 BeefTV）。

> 已消除：INTX 画布「打开剪辑台」是否传上下文——源码确认为**不传**（见 3.5）。

---

## 第七部分：落地记录

### 批 1（2026-11-24）

只做批 1，不碰画布、剪辑台与快照 codec。

| 文件 | 改动 |
|---|---|
| `web/src/constant/navigation-tools.ts` | `config` 一项拆为 `config-channels` / `config-storage`，支持可选 `to` |
| `web/src/components/layout/app-top-nav.tsx` | 按 `to` 渲染；新增 `isNavigationToolActive`，按 `?tab=` 区分高亮 |
| `web/src/components/layout/app-config-modal.tsx` | `AppConfigPanel` 增加可选 `onTabChange`（默认行为不变） |
| `web/src/pages/config/index.tsx` | 读 `?tab=` 作为 `initialTab`；切标签用 `replace` 写回 URL |
| `web/src/i18n/locales/{zh-CN,en-US}.ts` | 新增 `navigation.config-channels` / `config-storage` |

**验证**：4 个文件通过 TypeScript `transpileModule` 语法检查；未跑 `pnpm verify`（依赖未安装），未跑构建，未在真机点击。类型层面唯一风险点是 `t(\`navigation.${slug}\`)` 的动态 key，已确认 i18n 资源为普通对象而非严格 key 联合。

**回滚**：以上改动相互独立，`git checkout` 这 5 个文件即可恢复。

### 批 2（2026-11-24）

| 文件 | 改动 |
|---|---|
| `web/src/application/canvas/canvas-assets.ts`（新增） | 画布节点 → 资产的纯函数：`collectCanvasMediaNodes`、`canvasNodeToAsset`、`importCanvasMediaToAssets`、`archivedCanvasNodeIds`。返回判别联合，不使用 `as` 压平类型 |
| `web/src/components/canvas/canvas-top-bar.tsx` | 「生产」菜单新增「归档到资产库」，新增必填 prop `onArchiveToAssets` |
| `web/src/pages/canvas/project.tsx` | 接入批量归档（`confirmSave` 后才提示成功）；剪辑台跳转改为带 `?from=&title=` |
| `web/src/pages/editing-studio/index.tsx` | 读 `?from=&title=`；该画布素材置顶并提示数量；「返回」回到原画布 |
| `web/src/pages/home/index.tsx` | 最近项目标题旁加「新建项目」快捷按钮 |
| `web/src/i18n/locales/{zh-CN,en-US}.ts` | 归档 4 条 + 剪辑台 5 条 + 首页 1 条 |

**关键设计取舍**

- 归档是**显式动作**，不做“生成即归档”：否则资产库会随每次重试膨胀，且用户无法区分哪些是想留的。
- 去重键用 `metadata.nodeId`，与画布单节点「保存到资产」一致；节点删掉后资产不连带删除（资产是独立生命周期）。
- 图片有 `storageKey` 时 `dataUrl` 写空串，读取走 storageKey，避免快照里再存一份 base64。

**验证**：6 个文件通过 `transpileModule` 语法检查；i18n 键新旧双向对齐；`CanvasAssetInput` 与 `addAsset` 入参逐字段比对一致。未跑 `pnpm verify`、未构建、未真机点击。

**未做**：成片从剪辑台回资产库（OpenCut 导出结构改动面大）；生成结果自动归档（需产品决策）。

### 批 3（2026-11-24）

| 文件 | 改动 |
|---|---|
| `web/src/components/layout/command-palette.tsx`（新增） | ⌘K 命令面板：9 个固定动作 + 最近 5 个画布；↑↓/Enter/Esc；键盘与鼠标共用高亮索引 |
| `web/src/components/layout/empty-state.tsx`（新增） | 统一空状态组件，支持可选动作按钮 |
| `web/src/components/layout/app-top-nav.tsx` | 注册 ⌘K 监听；侧栏增加搜索入口（带 ⌘K 提示）；渲染面板 |
| `web/src/pages/canvas/index.tsx`、`web/src/pages/assets/index.tsx` | 空状态改用 `EmptyState`，保留各自文案与 `min-h` |
| `web/src/i18n/locales/{zh-CN,en-US}.ts` | 新增 `commandPalette.*` 11 个键 |

**取舍**

- 面板只做导航与创建，不放设置项开关——否则会成为第二套配置入口。
- 搜索结果带 `keywords`（含拼音/英文别名），中文文案下也能用 `canvas`、`cib` 之类的词命中。
- 不用 antd `Empty`（自带插图与固定文案结构），沿用项目已有的 `surface-sunken` 卡片语言。

**验证**：4 个文件语法检查通过，`commandPalette` 中英键集合完全相等（各 10 个叶子键）。未跑 `pnpm verify`、未构建、未真机按 ⌘K。

---

## 附：证据索引（BeefTV，commit `a5217dd`）

- `web/src/router.tsx` — 路由与隐藏外壳规则
- `web/src/layouts/user-layout.tsx` — 全局外壳、主题切换、通知栈
- `web/src/components/layout/app-top-nav.tsx` — `hideChrome`、⌘K
- `web/src/components/layout/workspace-sidebar-nav.tsx` — 侧栏导航项（`buildNav`）
- `web/src/pages/home/home-dashboard.tsx` — 首页三段式
- `web/src/pages/canvas/index.tsx` — 项目库
- `web/src/pages/create/index.tsx` — 对话式创作
- `web/src/pages/canvas/use-canvas-timeline-asset-insert.ts` — 画布内时间线

> 本文不包含 BeefTV 源码副本，仅引用路径与行为描述。
