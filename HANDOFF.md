# HANDOFF

> 起点：`dev` @ `76a6f2c`（本文档极简版曾为 `114aa78`）。**以此为准，别照旧文档找生图入口。**
> WorkBuddy 接手后先同步到 `114aa78`，随后完成 26 处裸值递减与 M2.5-③ 原生另存为，**已一并提交到 `dev`**（见提交记录）。

## 现状

- **M2.5-③ 原生另存为已在本轮补齐（代码完成，待真机）。** 安装包仍未做。生图入口统一在节点提示词面板（`web/src/components/canvas/canvas-node-prompt-panel.tsx`）；「生成配置」节点、首页、`/prompts`、移动端布局均已下线；本地 Agent 为 opencode 单车道。
- 本轮修复（`76a6f2c`）：矮窗口下节点面板先压输入框高度（默认 160px、最少 76px），压到最小才上移。1280/1366 的「生成」按钮恢复可点，1440/1920 不变。用户认可，等对齐 BeefTV 时再看细节。
- 基线全绿：web tsc 0 错 / tokens 119（已递减 26，门禁基线 145）/ boundaries OK / build OK / overflow 1280-1440-1920 无溢出 / vitest src 758（原生另存为新增 6 例）；canvas-agent 单测 76/76、tsc 0 错。

## 接下来

1. **真机验收**（只能人做）：**另存为保存对话框**（取消不报成功、只读目录报错、文件真能打开，见 `pending-test` 新增一节）；节点面板真实生图（用户说后面再测）；36px 手感与裁切手柄、面板压缩手感（随 BeefTV 轮一起看）；1280/1440/1920 观感；**Tauri 桌面渲染——现有 release exe 是 11-16 构建，不含本轮改动，要验需先 `tauri build --no-bundle`**（不装 MSI/NSIS）。
2. 可选：裸值按基线只降不增，`npm run check:tokens` 把关。剩余 119 处里，neutral 的 hover 双写 / 图片遮罩、全部 radius 非常规档位（18/24/1/3px）、fontsize 需选 typ-\*、blackwhite 需辨别是否叠图——**都要逐个判断，不要机械批量替换**。
3. M2 剩两条：浏览器两种出网方式请求对照；台账确认不含 Key。

## 纪律

- 不擅自 commit/push、不动 master；未经用户同意不发真实厂商请求、Key 不进文件不进聊天；没验的写「未验证」。
- `readTaskOutcome()` 三态是唯一重发判定入口，`confirm` 不得退化为 `allowed`。
- BeefTV 仅参考、禁抄代码；OpenDirector 可复用须署名。
- 改 `services/api/image.ts` 必跑 `src/services/api/image.test.ts`；不新增边界值。

## 坑

- 看到 `codex*` 属性报错 → 先比 blob SHA 查本地旧文件，别改远端。
- `vitest run` 全量因 `bun:test` 收集失败是既有问题，门禁是 `vitest run src`。
- 本机直连 GitHub 会被重置，推送走代理：`HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 git push origin dev`；`playwright install chromium` 同样需代理（本机已装）。
- 4 张视觉截图未入库，别按路径找。

## 进度补充（WorkBuddy 接手轮，已提交）

- 已同步本地到 `114aa78`（`76a6f2c` 面板修复 + 极简 HANDOFF 共 5 个文件）。
- 已递减 26 处安全裸值（145→119）：`config-tasks.tsx` 13、`config-local-proxy.tsx` 7、`channel-editor-drawer.tsx` 5、`canvas-delete-projects-dialog.tsx` 1。全是纯文字色 `text-stone-500→text-muted-foreground` 与边框 `border-stone-*→border-border`。
- **有意不动**：hover 双写反馈、图片 hover 遮罩（`asset-picker-modal`）、7 处非常规圆角（`rounded-[18px/24px/1px/3px]`）、状态语义色、叠图黑白——映射表没覆盖或改了会变视觉，按「判断不了就不动」处理。
- 递减后全套复跑全绿：tsc 0 / tokens 119 / boundaries OK / vitest 752 / build OK / overflow 三档无溢出。
- 这 4 个递减文件已随本轮提交到 `dev`。

## 进度补充（第二轮：M2.5-③ 原生另存为，已提交）

按《成熟产品实施计划 v2》的 M2.5 第 3 项补完「原生另存为」——没再继续递减裸值，因为方案里没有这一项。

- 新增 `web/src/lib/runtime/save-file.ts`：落盘唯一出口，返回 `saved`（带落盘路径）/ `canceled` / `failed` 三态。桌面走 `plugin-dialog` 的 `save` + `plugin-fs` 的 `writeFile`；浏览器动态 import `file-saver` 降级。
- 新增 `web/src/hooks/use-save-file.ts`：`useSaveNotice`（取消静默、失败报错、成功显示路径）与 `useSaveFile`（一步保存）。
- 9 处 `saveAs` 全部迁移：画布项目导出（卡片与项目页）、画布列表批量导出、侧栏节点导出、资产包导出、单资产下载、节点图片/批量图下载、任务诊断导出、配置导出。侧栏与项目页原来「取消也报已导出」，已改为按三态提示。
- Rust 侧：`Cargo.toml` 加 `tauri-plugin-dialog` / `tauri-plugin-fs`，`lib.rs` 注册；`capabilities/default.json` 只开 `dialog:allow-save` 与 `fs:allow-write-file`，保存路径由 dialog 的 `save` 命令在运行时 `allow_file` 授权，没有静态放开整个磁盘。
- 门禁：tsc 0 错；`vitest run src` 758/758（新增 `save-file.test.ts` 6 例）；boundaries / tokens 119 / overflow 三档 / `vite build` 全过；`cargo check` 通过。
- **注意**：本地同步副本没有 `web/src-tauri/icons`（二进制没同步过来），`generate_context!` 会因此编译失败。验证时临时生成了占位图标，跑通后已删除；仓库里请用原有图标，别把占位图提交。
- **未验证**：真实 Windows 保存对话框、只读目录报错文案、安装包内落盘（安装包尚未构建）。

## M3.2 核查结论（**未动任何代码**，供接手方直接采用）

方案的 M3.2 写的是「参考 OpenDirector 的 AssistantPanel / AssistantConversations / AssistantPickers / AssistantLinkInfo，实现会话 / 引用 / 痕迹」。**核查结论：这三块在当前 opencode 单车道面板里都已经接线可用，不是「半个」。**旧版交接文档写的「M3.2 半个、无会话/引用面板」是过时的，别照它判断。

逐项对照（均在 `web/src/`，已核实是真接线、不是死代码）：

| 方案要求 | 当前实现 | 位置 |
|---|---|---|
| 会话（新建/恢复/删除/切换） | `AgentHistoryView` 真实渲染在 `history` tab，接 opencode thread API | `components/agent/agent-history-view.tsx`、`opencode-agent-panel.tsx:552` |
| 引用（@提及画布节点） | `canvasReferences` 进入 composer 可提交判定与发送请求，输入框有内联 token 解析、引用预览卡 | `agent-chat-composer.tsx:59`、`agent-chat-prompt-input.tsx`、`agent-canvas-reference-preview.tsx` |
| 痕迹（来源/链接/工具） | `Streamdown` 渲染 + `linkSafety` 外链确认弹窗 `AgentLinkModal`；工具调用卡、事件日志 tab | `agent-chat-message.tsx:18/26`、`agent-log-view.tsx` |
| 权限/费用确认 | 三档 `auto`/`confirm` + `planAgentOps` + 费用/破坏性判定 + 确认卡 | `lib/canvas/agent-permissions.ts`、`components/canvas/agent-confirm-dialog.tsx` |

**真正缺的只有两件**（OpenDirector 的 `AssistantConversations` 有、当前 history 列表没有）：
1. 会话**搜索**（按标题过滤）
2. 会话**重命名**

### 重要警告

**不要机械移植 OpenDirector 那四个组件。** 它们依赖本项目根本没有的 backend/chat 服务、多模型路由和 citation 协议；照搬会造出一套与现有 opencode 面板并行、无法运行的死代码，违反 AGENTS.md「不做重复建设、最少行数」。

正确做法：在 `agent-history-view.tsx` 上增量补「搜索 + 重命名」，然后逐项端到端验证上表四块，把验证步骤写进 `pending-test`。

### 参考源码位置

OpenDirector 源码此前被我解压在沙箱 `/root/.codebuddy/artifact/<session>/opendirector/OpenDirector-main/`（`src/canvas/Assistant*.tsx`）。**该目录是沙箱临时目录，不保证持久**；接手方若需要，请让用户重新提供，不要去找旧路径。

## 第三轮：Linux 沙箱真跑桌面端（2026-11-18）

这一轮没有继续推进里程碑，而是把桌面应用真正跑起来验证——因为项目最大的教训是「单测全绿 ≠ 真机正确」。

### 做法

`cargo build`（debug）→ 在 Xvfb `:77`（1600×1000，openbox）里启动 `target/debug/intx`。debug 构建连 `devUrl`（3000），所以同时起了 `vite dev`。

**关键坑（已踩）**：`xdotool getwindowgeometry` 的 Position 是含窗口装饰的框架位置，客户区真实原点要用 `xwininfo` 的 `Absolute upper-left`。两者差 22px，足以让点击全部落空并误判成「功能不工作」。项目纪律要求「坐标必须实测」，这次是活例子。

### 发现并修复的真缺陷

**桌面版根本连不上本地 Agent。** 前端 `readLocalAgentConfig()` 调 `invoke("read_agent_config")`，Rust 侧从未定义这个命令（远端 `dev` 也没有）；异常被 `catch` 吞成 `null`，界面只提示「没有发现本地 Agent」——把「没实现」伪装成「没启动」。桌面界面又没有手填地址/token 的入口，所以这条路彻底断了。

修复：`src-tauri/src/lib.rs` 新增 `read_agent_config`（读 `~/.infinite-canvas/canvas-agent.json`，文件缺失 / JSON 坏 / 字段为空一律返回 `None`），注册到 `invoke_handler`；`Cargo.toml` 加 `serde` + `serde_json`。

**对照实测**：修复前顶栏「OpenCode 未连接」；修复后「● OpenCode 已连接」，历史标签能拉到会话。

### 顺带验掉的

- **M2.5-③ 三态**（Linux）：Cancel 静默无提示；保存到 `/tmp` 提示「已保存到 <路径>」且文件 1934 字节真实落盘；保存到 `/proc` 提示「保存失败，请重试或换个位置」，应用不崩。
- **导出不含 Key**：`config.apiKey` / `channels[].apiKey` / `webdav.password` 均为 `""`，全文无 `sk-`。
- **M3.2 搜索 + 重命名**：3 条会话 → 搜「雨夜」筛到 1 条；铅笔改名后 UI 即时更新且 opencode 侧持久化（PATCH 200）。
- **时间戳**：显示 `2026/11/18 20:31:44`，毫秒 bug 没复发。
- **持久化**：新建画布后重启应用仍在。

### 仍未验

- **release 内嵌产物**：裸 `cargo build --release` 会因缺 `custom-protocol` panic（`lib.rs` 启动检查），必须 `pnpm tauri:build`。本轮只验了 debug 连 dev server。
- Windows / macOS 的对话框与路径行为。
- 真实厂商请求（视频竖切 M2.6 仍需要你本人真机 + 真实 Key）。

### 环境备注

- 本地同步副本没有 `web/src-tauri/icons`（二进制未同步），构建前需临时生成占位图标，**跑通后已删除，不要提交占位图**。
- `pkill -f "target/debug/intx"` 会匹配到自己的命令行并把当前 shell 一起杀掉；杀进程用 PID 或更精确的模式。

---

## 第四轮：选区浮栏对齐 / 等距分布（2026-11-18 晚）

### 做了什么

多选后的悬浮栏此前只有「打组 / 解散组」。工具注册表里 `align-*`、`distribute-*` 八条定义齐全，但 `CanvasSelectionToolbar` 只渲染分组两项——**定义了却没有任何 dispatch，等于功能不存在**。本轮补齐：

- 新增 `web/src/lib/canvas/canvas-align.ts`：纯计算，`alignNodes` / `distributeNodes`，不碰 React 与 store。
- `canvas-selection-toolbar.tsx`：排布改成「六个对齐 | 两个等距 | 打组 / 解散」；等距在选中少于三个时置灰；浮栏出现条件从「能打组」放宽到「至少两个节点」——之前选中两个已在同一组的节点时浮栏整个消失。
- `project.tsx`：加 `alignSelection` / `distributeSelection` 两个回调（约 12 行），写回时 `next === prev` 就跳过。
- 中英文案各 9 条，放 `canvas.nodeToolbar` 下。

### 三个容易写错、都有用例钉住的点

1. **居中对齐用包围盒，不是中心平均值。** 一个宽节点 + 两个窄节点时，平均值会把整体拉向宽节点那侧，看起来就是歪的。
2. **等距按空隙均分，不是中心距。** 节点宽窄不一时中心距相等反而更乱。
3. **分组框移动时成员必须一起走。** 成员坐标是绝对值，分组框位置变了不会自动带着成员；漏掉这一步的用户可见后果是「框飞走了，节点留在原地」。同时「选中分组 + 组内某个成员」时成员不能算两次位移，这个单独有用例。

另外：已对齐时返回原数组引用，调用方据此跳过写回，否则会往 undo 里塞一个空步骤。

### 门禁

`tsc` 0 错、`vitest run src` **777/777**、`vite build` 通过。单文件 19 例，三次破坏性自检（去掉原引用短路 / 取消分组成员去重 / 等距忽略节点尺寸）分别变红，恢复后复绿。

### 验证到哪一步（别夸大）

Linux 沙箱里**只验到「浮栏渲染 + 位置计算生效」**：截图确认六个图标排布正确；临时让页面在加载后自动跑一次 `alignNodes(..., "left")`，第三个节点从 x=300 移到 x=0，与另外两个左边缘对齐，视觉证据成立。

**没验到的是「真的点到按钮」**：这个沙箱的 WebKitGTK 里，画布 pointerdown 正常（双击弹出建节点菜单），但按钮 click、双击菜单项、`Ctrl+A` 都不触发。按钮渲染和鼠标坐标都对，判断是合成的按下/抬起被判成非用户手势。**不要据此说功能已验证**，真机点一遍的清单写在 `pending-test` 的「选区浮栏对齐与等距分布」一节。

临时注入的种子节点、自动对齐、自动全选、`__diag` 上报、探针路由与页面**全部已删除**，`index.html`、`router.tsx`、`project.tsx` 已恢复原状（`grep -rn "__probe\|__diag\|__SEED\|临时"` 为空）。

### 顺带发现（未修，留待判断）

桌面端跑起来后顶栏出现过一条 `快门 存储数据损坏或字段非法，已拒绝覆盖 重试本地保存`。它出现时是**临时种子节点**写进画布的那次运行，疑似与「非持久化结构的节点直接 `setNodes` 进画布」有关；清掉临时代码后常规路径没再复现。**未定位、未修**——下次真机能复现的话，从 `createProjectWriteQueue` 的校验分支往上查。

---

## 第五轮：release 内嵌产物验收（2026-11-19 凌晨）

用户选了待办清单里的 A 项。目标是把「发版能不能成」的最后一块自测门过掉。

### 结论

`pnpm tauri:build --no-bundle` 退出码 0，产出的 `src-tauri/target/release/intx` 在**没有 vite dev server** 的情况下直接启动，渲染出完整的「无限画布」首页（顶栏 v0.20.0），不是连接失败页。3000 端口全程无监听；运行日志为空，`lib.rs:49` 的 `!debug_assertions && is_dev()` panic 未触发；二进制里能查到 `dist/assets` 的实际文件名（`index-W_ZgPg6h.js` 等）。内嵌产物成立。

### 做法与坑

- 工作区（解包副本，非 git checkout）不含 `src-tauri/icons`，而 `tauri.conf.json` 引用了它，`generate_context!` 编译必需。用 PIL 临时生成 5 个占位图标编译，验证后已删除、不提交。
- Xvfb `:77` 在上轮结束后已停，只留下陈旧的 `/tmp/.X11-unix/X77` socket；重启 Xvfb + openbox 后正常。
- `--no-bundle` 是刻意的：Linux 的 deb / AppImage 打包依赖 linuxdeploy 工具链，本沙箱没装，跳过不影响「内嵌资源是否生效」这个判断。

### 仍未验证（已写进 pending-test）

Windows / macOS 安装包；Linux deb / AppImage 打包；release 下 `read_agent_config` 的完整连接链路（本机未启 canvas-agent，顶栏显示未连接）。另注：release 首次启动显示「还没有画布」，与 debug 实例的数据是否互通未查。

**没有代码改动，也没有 commit / push。** 本轮只改了文档：`pending-test` 中英文 + 本文件。

---

## 第六轮：存储错误文案分家（2026-11-19 凌晨，B 项）

### 问题

上一轮用临时种子节点跑桌面端时，顶栏出现过「快门 存储数据损坏或字段非法，已拒绝覆盖」。定位后确认触发的是**写入前校验**：`codec.copy()` 发现草稿不合 schema，返回 `snapshotCorruptData()` —— 和读取时发现已存数据损坏用的是同一句话。用户看到「数据损坏」会以为画布已经丢了，实际只是本次草稿某个字段非法，**已保存的数据从未被覆盖**。

### 改法（刻意只拆文案，不拆错误码）

- `snapshot-storage.ts`：新增 `snapshotInvalidData()`，`copy()` 的两条失败分支改用它；`decode()` 仍用 `snapshotCorruptData()`。
- `task-storage.ts`：新增 `invalidTaskData()`，`copyTask()` 用它；`decodeTasks()` 仍用 `corruptData()`。
- 错误码**保持 `corrupt_data`**：它是写队列和一堆契约测试的分支契约，拆码要动十余处断言和消费者，收益却只是内部区分。文案分家已经解决用户可见的问题。真将来 UI 要按两类错误给不同操作（损坏→重新加载 / 草稿非法→修正字段），那时候再拆码不迟。

### 门禁

新增 `storage-error-message.test.ts` 4 例，钉住两条路径的文案不同。破坏性自检：把 `copy()` 改回 `snapshotCorruptData()`，2 例立刻变红，恢复后复绿。全量 `tsc` 0 错、`vitest run src` **781/781**、`vite build` 通过。

**未提交 / 未推送**：本轮改了 `CHANGELOG.md`、`HANDOFF.md`、`snapshot-storage.ts`、`task-storage.ts` 和新增测试文件，等用户明确授权再推。

---

## 第七轮：工具注册表 UI 接线 + 结构预算（2026-11-20，#50–#53）

### 背景纠偏

配景文档（INTX-重构方案.md §6.8）写的「v2.2 已落地四工具栏由解析结果长出 / useToolbarPrefs / 第七组 E2E」是**已删除 v2 分支的历史**，不是当前 dev 的事实。远端 dev 最新为时间线重做 `3075654`，`main.tsx` 根本没有安装注册表；本地 grep 也证实 `resolveToolbar*` / `resolveAddNodeMenuCommands` 只在单测里出现过。**结论：注册表的 UI 接线是真欠账，不能照旧文档当作已完成。**

### 本轮做的（严格不破坏既有按钮 DOM / class / E2E selector）

- `main.tsx` 同步 `installBuiltinTools()`——异步会让首帧工具栏为空。
- 新增 `src/lib/canvas/tool-wiring.ts`：`buildToolContext()` 把 UI 状态映射成 `ToolContext`，`toolView()` 按 id 查单工具的可见/禁用/激活。**定义缺失返回中性值**，注册表没装时 UI 不退化。
- 主工具栏的撤销/重做、多选悬浮栏的等距按钮，禁用/显隐改由注册表判定；按钮图标、i18n、class、顺序全留原处。
- 新增 `src/hooks/use-toolbar-prefs.ts`：localStorage `intx-toolbar-prefs-<toolbar>-v1`，读盘用 `migrateToolbarPrefs()`，损坏/隐私模式回落默认；偏好不进 `.intx`、不进撤销。
- 空起始态收进 `canvas-empty-state.tsx`，渲染下沉到 `InfiniteCanvas`（节点数 prop），判态与文案全来自 domain `canvasStarter` 纯函数；面板不挡右键/双击创建。
- 连线被拒给「请连组里的节点 / 换一个目标节点」人话，函数并入 `canvas-node-geometry.ts`（避免 project.tsx 再膨胀）。
- `check-tokens.mjs` 增加 `OVERLAY_CLASS_ALLOW`（按精确 class 而非行号豁免叠彩片段/视频的真黑白），抽屉 4 处 `text-[10px]` 收成 `text-xs`；token 裸值 145→116。

### 门禁与验收

- `pnpm verify` 全绿：70 文件 / **850 用例**；typecheck / boundaries / tokens 116 / structure（project.tsx 守在基线内）全过。
- 第七组 E2E `web/registry_ui.mjs`：多选出对齐栏 → 等距按钮禁用态随节点数 → 左对齐后两点 x 收敛到整数 → console 零错误。
- 六组旧 E2E 全绿：时间线拖动持久化、split、吸附、文字轨、播放联动高亮、MP4/WebM 导出实证；console 均零错误。

### 未做 / 边界

- 添加菜单、节点悬浮栏、右键菜单**未**接注册表——它们与生产 UI 的按钮集差异大，硬接会破坏既有 DOM 与 E2E；注册表定义先行、UI 渐进接线是当前策略。
- 结构基线仍卡 project.tsx 只许降；新增逻辑一律独立文件，没往里塞。
- **本轮未 commit / 未 push**，等用户明确授权再推。

---

## 第八轮：收尾 #82/#83（2026-11-20）

### #82 i18n 与文档收口——核查后确认已完成，未重复劳动

四项要求在当前代码中**全部已满足**（早期任务被后续工作顺带完成）：
- zh-CN/en-US 的 `modelSelect` 段落与 `composer.selectModel` 文案齐全；
- CHANGELOG Unreleased 第 56 行已有「OpenCode 车道支持选择模型」条目；
- pending-test.mdx 中文第 241 行、英文第 330–333 行已有模型选择待验收条目；
- todo.mdx 中英两版已把「模型选择」移出，只剩 Timeline + Skill 两项。

### #83 构建级检查——六项真实退出码（构建级 ≠ 真机通过）

| 检查 | 退出码 | 结果摘要 |
|---|---|---|
| web `pnpm typecheck` | 0 | tsc --noEmit 无错 |
| web `pnpm exec vitest run src` | 0 | 70 文件 / 850 用例全过 |
| web `pnpm check:boundaries` | 0 | domain 无 IO、厂商请求单一出口 |
| web `pnpm build` | 0 | vite build 17.37s；仅既存大 chunk 提示 |
| canvas-agent `pnpm test` | 0 | 81 用例全过、0 失败 |
| canvas-agent `pnpm build` | 0 | tsc -p tsconfig.json 无错 |

**边界**：构建级全绿不等于真机通过；厂商请求、Tauri 桌面端、真实扣费场景仍未真机验证。本轮**未提交、未推送**，等用户决定。

---

## 第九轮：预览字幕与导出同源（2026-11-20，#112）

### 问题
时间线预览小窗此前只画视频/图片帧，文字轨字幕只在导出时烧进画面——用户「预览看不到字幕、导出却有」，预览与成品不一致。

### 做法（同源，不是两套逻辑）
- 新增 `src/lib/canvas/timeline-text.ts`：`textOf()`（文字节点取文本，优先 content 其次 texts）+ `activeTextOverlays()`（当前时刻命中的字幕列表）。**导出与预览共用这两个纯函数**，同一时刻命中的字幕内容永远一致。
- `timeline-export.ts`：删掉本地 `textOf`，烧字循环改调 `activeTextOverlays()`——导出语义不变，只把文本判定收敛到单一入口。
- `canvas-timeline-dialog.tsx`：预览窗加 `relative`，叠字幕层（底部居中、白字黑描边 `text-white` + 内联 text-stroke/shadow、多条纵向错开）；`text-white` 已在 check-tokens 的 OVERLAY_CLASS_ALLOW 白名单，未触发裸值回退。

### 验收（导出与预览在相同四时刻对照，结论一致）
- 同源单测 `timeline-text.test.ts` 3 例：文本提取、空档命中、多字幕顺序。
- 预览 E2E `web/preview_subtitle_ui.mjs`：0.5s 无 / 2s HELLO / 3.5s 无 / 5s WORLD，console 零错误。
- 导出实证 `p4_text_verify.mjs` 重跑 + ffprobe + 抽帧白像素：MP4/h264/6s；0.5s=0、2s=241、3.5s=0、5s=305，与预览完全对应。
- `pnpm verify` 全绿：71 文件 / 853 用例，结构/令牌门禁守住。

边界：预览字幕是缩略窗内的近似布局（字号 11px），非 720p 像素级等同导出；内容同源已由共用纯函数 + 单测钉住。
