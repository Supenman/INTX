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
- 本机直连 GitHub 会被重置，推送优先走代理：`HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 git push origin dev`；`playwright install chromium` 同样需代理（本机已装）。
- **2026-11-21 补充**：沙箱重建后 7897 代理没了，`github.com:443` 直接 TCP 不通，但 `api.github.com:443` 和 `gh api` 正常。这时用 REST 的 git-data API 推：POST `git/blobs`（base64）→ POST `git/trees`（`base_tree` = 父提交树）→ POST `git/commits` → PATCH `git/refs/heads/dev`。API 会规范化 message 尾部换行，**远端 SHA 会与本地不同但 tree 完全一致**；本地要用 `git hash-object -t commit -w --stdin` 重建远端提交对象后 `git update-ref`（分支和 origin/dev 都要改），否则 status 会一直显示领先。远端 CI 由 ref 更新正常触发。
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

---

## 第十轮：三处菜单接注册表 + README 重写（2026-11-20，#113 + README）

### README 整篇重写
把原 `basketikun/infinite-canvas` 的赞助商表、社群链接、原作者联系方式、Star History、外链全删掉，换成我们自己的仓库（`Supenman/INTX`）与技术栈徽章；核心功能按实际实现写（含时间线剪辑、费用预估、任务中心）。全仓库无任何旧项目引用残留。

### 三处菜单接注册表（两处落地，一处判定不接）
- **右键菜单（`canvas-context-menu.tsx`）**：把注册表 `node-context-menu` 定义从「理想化草稿」（生成/批量连接/改名）改为**与生产按钮逐一对齐**（截帧三连/提取音频/打组/解散/复制/删除）。新增 `ToolContext.canCaptureVideoFrame/canExtractAudio/canGroup/canUngroup` 与 `labelKey` 支持 i18n。组件按 `resolveNodeContextMenu` 渲染，只保留 id→图标/回调映射。5 例单测 + 浏览器 E2E（图片菜单只有复制/删除、复制生效、删除生效、零错误）。
- **添加菜单（`canvas-create-menus.tsx`）**：`resolveAddNodeMenuCommands` 增加 `nodeCommands` 注入参数——画布用的是 lib 的 CanvasNodeDefinition，与 domain 的 NodeDefinition 是两套，硬接会换错节点集。现在注入生产节点，节点列表（文本/图片/视频/音频/组）与顺序不变；E2E 验证创建生效、零错误。
- **节点悬浮栏（判定不接）**：注册表 `node-hover` 定义的是「复制/生成/取消/删除」，生产悬浮栏是「信息/解散组/删除/重试/下载/存资产/编辑/生图/字号/上传 + 动态 imageTools」——几乎没有交集。硬接会凭空塞进三个生产没有的按钮，是产品倒退。**结论：不接，保持原样。** 若要接，需先把 node-hover 定义重写成生产按钮集，属于「重做悬浮栏」而非「接线」。

### 门禁与验收
- `pnpm verify` 全绿：71 文件 / **858 用例**（新增 5 例右键菜单 + 之前同源 3 例）。
- 七组 E2E 回归全 exit=0、零错误：多选对齐、时间线拖动持久化、文字轨、播放联动高亮、预览字幕、右键菜单、添加菜单。

---

## 第十一轮：时间线编辑纳入撤销栈（2026-11-20，#114）

### 问题（真 bug，用户必然撞到）

`CanvasHistoryEntry` 快照只装 `nodes / connections / chatSessions / activeChatId / backgroundMode / showImageInfo`，**没有 `timeline`**；而时间线的所有编辑走的是另一条路：

```ts
onTimelineChange={(next) => { if (currentProject) updateProject(currentProject.id, { timeline: next }); }}
```

它只改 `project.timeline`，不碰 `nodes`，撤销栈的 diff 判定完全看不见变化。后果：切分切错、trim 拉错、删错字幕、拖错 clip，**按 Ctrl+Z 毫无反应**。

### 做法

- `CanvasHistoryEntry` 增加 `timeline: ReturnType<typeof resolveTimeline> | undefined`（用 `ReturnType` 而非新 import `Timeline`，因为结构预算只剩 1 行余量）。
- `createHistoryEntry()` 带 `timeline: currentProject?.timeline`，依赖数组同步。
- `applyHistory()` 回写 `updateProject(projectId, { timeline: entry.timeline })`——撤销 timeline 必须落到 store，否则抽屉拿到的是旧值。
- 历史 diff 判定加 `previous.timeline === next.timeline`（领域函数都返回新对象，引用比较足够）。
- 加载项目时的 `lastHistoryRef` 初始快照也补上 `timeline`，避免首帧误记一步假历史。
- **合并策略复用既有 180ms debounce**：拖动时每帧 `updateProject` 都在跑，但每次依赖变化都会重置计时器，停手 180ms 后才入栈一次。

### 验收

`web/undo_timeline_ui.mjs`（第八组 E2E）：
- 移除片段：3 → 2 → 撤销 3 → 重做 2 → 再撤销并刷新仍是 3（持久化正确）
- 拖动片段：`left` 从 0px 拖到 144px，撤销**一次**即回到 0px → `DRAG_UNDO_IS_SINGLE_STEP: true`，证明几十帧移动被合并成一步，不会「只退一帧」
- console 零错误

门禁：`pnpm verify` 71 文件 / 858 用例全绿；九组 E2E 全 exit=0；结构预算 3860（`project.tsx` 基线从 3110 降到 3108，净减 2 行）。

**未推送**，等授权。

---

## 第十二轮：清理死代码 + 品牌去上游（2026-11-20）

用户授权「不好的功能也可以删掉」，但选择「先不砍功能，只清死代码」。

### 死代码：1056 行，用编译器验证而非 grep 猜

移出 `domain/node/{layout,connection,prompt,validate}.ts` 与对应 4 个测试文件。

验证方式：**先 `mv` 走再跑 `tsc --noEmit`**，编译器只报 `domain/index.ts` 里 4 处门面导出；再确认 8 个 `from "@/domain"` 的消费者都没用到这些符号，才删掉门面导出。这比逐个 grep 可靠——grep 会漏掉 re-export 与类型引用。

**修正了初判**：最初把 `grid.ts`（107 行 + 测试 103 行）也算进死代码，但实测发现它被 `storyboard.ts` 的 `parseGrid` 引用（分镜宫格在用），**保留**。所以实际删除 1056 行，不是 1498 行。

这 4 个模块是早期 domain 层的「理想架构」，后来画布实际走 `lib/canvas/canvas-node-geometry.ts`，形成两套几何算法只有一套在用——这正是「重复造轮子」的字面证据。

### 品牌去上游：只改无功能依赖的两处

- `hooks/use-version-check.ts`：版本与更新日志 URL 从 `basketikun/infinite-canvas` 改为 `Supenman/INTX/dev`。**此前是功能性 bug**：用户看到的「发现新版本」是上游版本号，点更新跳别人仓库，自己产品的更新永远提示不到。
- `constant/env.ts`：`REPO_URL` 改为 `https://github.com/Supenman/INTX`。

### 未改（有真实功能依赖，改了会坏）

| 位置 | 现状 | 为什么不改 |
|---|---|---|
| `agent-connect-view.tsx` | `npx -y @basketikun/canvas-agent@latest` | 改包名要先把 agent 发布到自己的 npm scope，否则用户跑不起 |
| `use-config-store.ts` | `LOCAL_PROXY_PACKAGE = "@basketikun/canvas-proxy"` | 同上 |
| `constant/env.ts` | `PLUGIN_REGISTRY_URL` 指向上游 CDN 的 `plugins-dist` | 改了我们没有插件清单，插件市场会空 |
| `constant/env.ts` | `DOCS_URL = https://docs.canvas.best` | 我们没部署文档站 |

### 门禁

`pnpm verify` 全绿：67 文件 / 802 用例（原 71 / 858，减少 4 个测试文件、56 个用例）；typecheck / boundaries / tokens / structure 全过。

---

## 第十三轮：品牌收口 + React Flow 试点（2026-11-21）

### 品牌：1 处代码改了，4 处卡在发布能力

| 位置 | 结果 |
|---|---|
| `use-version-check.ts` | ✅ URL 改为 `Supenman/INTX/dev` |
| `REPO_URL` | ✅ 改为自有仓库 |
| `VERSION` | ✅ `v0.20.0` → `v0.1.0`（沿用上游版本号会导致永远提示不到更新） |
| `PLUGIN_REGISTRY_URL` | ❌ 实测我们 404 / 上游 200，改了插件市场会空 |
| `DOCS_URL` | ❌ `docs.canvas.best` 是上游站点；我们 `docs/` 缺 package.json 无法构建 |
| agent / proxy 的 `npx` 包名 | ❌ 用户直接复制到终端执行，没发布到自有 npm scope 前改了就是 404 |

**判断修正**：原计划「第 1 天修品牌」高估了收益。这 4 处不是代码问题，是发布能力问题（npm 账号、CI、静态托管）。已写成 `docs/品牌去上游-发布清单.md`。

### React Flow 试点

新增依赖 `@xyflow/react@13.0.2`（MIT），独立路由 `/canvas-flow-pilot`，**不碰生产画布任何文件**。

- 4 个自定义节点（图片/文本），3 条边，节点内输入框可正常打字（`nodrag`）
- 缩放、拖动、框选、Shift 加选、小地图、`fitView`
- 主题跟随 `canvasThemes`：初版硬编码白底，深色主题下边和连接点几乎看不见——**这本身就印证了「审美不行」不是抽象感受**

浏览器实测：4 节点 / 3 边 / 输入框打字成功 / 缩放变化 / 拖动位移 / 小地图存在 / console 零错误。
`pnpm verify` 全绿 802 用例。

### 试点的判断边界（未验证）

- React Flow 的 `parentNode` 能否承接现有分组语义：**未验证**，这是阶段 2 最大风险
- 100+ 节点性能：**未验证**
- 手感是否真的更好：**只能由用户上手判断**，自动化测试测不出来

### 试点第二版：接入用户真实项目

用户提供了 `无限画布 1.zip`（5 节点：2 图片 / 2 视频 / 1 音频，2 条连线，无 timeline），已抽成 `web/public/pilot-data/` 下的精简数据与素材，试点页改为读真实数据。

- 节点尺寸与相对坐标保持原样（图 380×640、视频 420×236、音频 340×120）
- `video:Myqn...` 在导出包里是 `.bin`，实测 `file` 与 `ffprobe` 确认是 MP4，改扩展名后浏览器可播
- 选中态改用 `theme.canvas.selectionStroke/selectionFill`，`text-[11px]` 收成 `text-xs`——`check:tokens` 当场抓到这 2 处，说明门禁在起作用

实测：2 图片 `naturalWidth>0`、2 视频 `readyState=4`、1 音频、小地图存在；唯一报错是本地 `VERSION` 未推送导致的版本检查 404，推送后自消。

### 试点结论：不迁移（2026-11-21）

用户上手真实项目后判断「差不多，没有明显差别」。

**决策：停止画布迁移，不做阶段 2（省下 4–6 人日）。**

这个结论的价值有两条，都要写清：
1. **反向证明了现有画布地基不差**——React Flow 是打磨过多年的成熟库，手感与我们自研的画布接近，
   说明「不好用」不是出在指针交互层（缩放/拖动/框选/连线）。
2. **把排查范围压窄了**——剩下的候选只有：视觉一致性、信息架构与入口密度、AI 流程、时间线交互。
   其中视觉和信息架构是 GPT 方案与我的方案都指出的，且**与换库完全无关**。

### 未删除试点代码（保留作为对照基线）

`src/pages/canvas-flow-pilot/` 与 `public/pilot-data/` 保留：
- 后续若再讨论换库，直接打开 `/canvas-flow-pilot` 就能对照，不必重做
- `@xyflow/react` 依赖保留（MIT，仅试点页引用，不进生产 bundle 路径）

若确认长期不用，删除清单：`src/pages/canvas-flow-pilot/`、`public/pilot-data/`、
`vite.config.ts` 的 `server` 块、`router.tsx` 的试点路由、`@xyflow/react` 依赖。

---

## 第十四轮：画布菜单瘦身（2026-11-21）

### 前置诊断：48 个交互入口

排查画布页所有可点入口后确认，痛点不是「操作手感」，而是**信息架构**：同一能力散落在 2–4 处。

| 能力 | 出现位置数 |
|---|---|
| 删除 | 4（右键 / 工具栏 / 顶栏菜单 / 快捷键） |
| 撤销 | 2（工具栏 / 顶栏菜单） |
| 打组 | 2（右键 / 添加菜单） |
| 导入 | 3（顶栏菜单 / 左栏 / 空态） |
| 文档 | 2（顶栏菜单 / 顶部导航） |

### 改动

`canvas-top-bar.tsx`：16 项平铺 → **4 组 13 项**。

| 分组 | 条目 |
|---|---|
| 项目 | 我的画布 / 新建画布 / 删除当前画布 |
| 文件 | 导入资产 / 导出当前画布 / 保存为工作流 / 插入工作流 / 预览生成链路 |
| 制作 | 生成历史 / 分镜流水线 / 时间线 |
| 编辑 | 撤销 / 重做 |

删掉 2 项：
- `home`——与「我的画布」完全重复
- `docs`——顶部导航已有文档入口

**保留 undo/redo 的理由**：主工具栏的撤销/重做按钮受偏好控制（`undoView.visible` 为条件渲染），用户关掉工具栏后仍需要一条退路，不能算冗余。

> 需要修正授权时的话术：原估算「砍掉 6–8 个冗余入口」，实际净减 2 项。真实收益是把 13 项按用途结构化分组，让用户先定位「想干什么」，而不是在 16 条平铺里扫。

### 验证

- `pnpm verify` 全绿：67 文件 / 802 用例，boundaries / tokens / structure 无回退
- 新增 `menu_groups_check.mjs`：实测渲染出 4 个分组标题 `["项目","文件","制作","编辑"]`、13 个条目，点「时间线」能正常打开
- 九组旧 E2E 全量回归全 PASS

### 顺带修掉一个长期误判

多组 E2E 一直在报 `Failed to load resource: 404`，之前当成「本地 VERSION 未推送，推送后自消」。这轮查清：

**`Supenman/INTX` 是私有仓库**（GitHub search API `"private": true`），raw 与 jsDelivr 一律 404，**与推不推送无关**。用同环境访问其他公开仓库的 raw 是 200，排除了沙箱网络问题。

处理：
- 曾尝试加 jsDelivr 兜底，实测同样 404，已回退，不留无效代码
- 结论与前置条件写入 `docs/品牌去上游-发布清单.md` 附二
- 九个 E2E 脚本改为**精确豁免这一条 URL**（`RAW_GITHUB_PRIVATE` 前缀），其它 404 仍然算失败；同时不再采集无来源信息的 `Failed to load resource` 文本

### 剩余缺口

- **`VERSION` 远端仍是 `v0.20.0`，本地是 `v0.1.0`**——本轮改动尚未推送，转公开前必须一致
- 视觉统一未动（62/88 用 antd、322 处 inline style、83 处 hex、53 处任意字号）
- 其余入口收敛（删除 4 处、导入 3 处）未做，本轮只动了顶栏菜单

---

## 第十五轮：入口收敛（2026-11-21）

### 先修正上一轮的一个错判

上一轮我说「删除 4 处、导入 3 处，收敛成 4→1、3→1」。**这个提法本身是错的**，执行前核对才发现：

| 入口 | 作用范围 |
|---|---|
| 右键菜单 `ctx-delete` | 单个节点，位置精确 |
| 节点悬浮栏 `delete` | 单个节点，鼠标划过即出现 |
| 底部工具栏 `tool-delete` | **全部选中**（`deleteNodes(new Set(selectedNodeIds))`），且仅选中时出现 |
| Delete 键 | **全部选中**，支持批量 |

真正冗余的是「单节点删除有两个入口」。如果按原话说砍到 1 个，批量删 10 个节点就得点 10 次右键——这是功能倒退回退，不是收敛。

导入同理：3 处里有一处是**节点级替换素材**（`onUpload(node)`），不是全局导入。真正的全局导入只有 2 处（顶栏菜单 + 底部工具栏），是「手边高频 + 菜单兜底」的合理分工，删任一都留缺口。

### 实际改动：删除 4 → 3

**删掉节点悬浮栏的删除按钮。**

依据不是「数得少」，是这三条：
1. 悬浮栏是**鼠标划过就出现**的浮层，删除是危险操作，误触代价最高
2. 图片节点的悬浮栏会堆到 14 个按钮（`baseToolbarTools` 3 + `nodeToolbarTools` 最多 11 + 图片工具箱），删除夹在中间
3. 同位置右键菜单就能删，且右键是**主动动作**，不会误触

连带清理（不留死代码）：
- `CanvasNodeHoverToolbarProps.onDelete` 整个 prop 移除（组件 + 类型 + 调用方传参）
- `Trash2` import 移除
- `canvas.nodeToolbar.removeTitle` 中英文案移除（唯一消费点已删）

### 验证：删了要证明没损功能

新增 `delete_entries_check.mjs`，四条路径逐条走完：

```
NODES_START: 4
HOVER_VISIBLE: true          ← 悬浮栏仍然出现
HOVER_HAS_DELETE: false      ← 删除按钮没了
HOVER_HAS_INFO: true         ← 其它按钮完好
CTX_DELETE_VISIBLE: true
NODES_AFTER_CTX_DELETE: 3    (4→3)  右键删单个 ✓
SELECTED_BEFORE_KEY_DELETE: true
NODES_AFTER_KEY_DELETE: 2    (3→2)  Delete 键 ✓
TOOLBAR_DELETE_VISIBLE_WHEN_SELECTED: true
NODES_AFTER_TOOLBAR_DELETE: 1 (2→1) 底部工具栏 ✓
ERRORS: []
DELETE_ENTRIES_PASS
```

- `pnpm verify` 全绿：67 文件 / 802 用例
- 十一组 E2E 全 PASS（含新增的 `delete_entries_check`）

### 导入：不删，但要说清为什么不删

顶栏菜单「导入资产」与底部工具栏上传按钮是同一动作。保留两处的理由：
- 底部工具栏的显隐受偏好控制（`intx-toolbar-prefs-main`），用户可隐藏，只留菜单项会留黑洞
- 只留工具栏则违背菜单「完整能力清单」的语义，用户按功能名找会找不到

### 已知债务（下一轮候选，本轮未动）

`src/domain/tool/definitions.ts` 里已定义 20 条工具（`main` / `selection` / `node-hover` / `add-node-menu` / `node-context-menu`），但实际渲染**全部硬编码在三个组件里**，注册表只有 `toolView()` 参与了可见/禁用判定。

具体说：`node-hover` 的 4 条定义（`node-duplicate` / `node-generate` / `node-cancel` / `node-delete`）没有任何 UI 消费，只有单测在断言它们。`delete-selection` 也没有被底部工具栏读取。

这才是「重复造轮子」最深的一层：注册表写好了一整套抽象，UI 没用上，等于两套真相源。真要治，得把三个组件的硬编码逐个换成注册表渲染——影响面覆盖画布所有交互，必须单独立项，不能混在本轮。

---

## 第十六轮：悬浮栏接注册表（2026-11-21）

### 先确认「接线」到底缺什么

`definitions.ts` 里每条工具都声明了 `action`（21 个不同值），但全项目**没有任何 dispatcher 消费它**。`buildToolContext` 只传 `canUndo / selectedCount` 这类布尔量，不传操作函数。

所以「接到注册表」不是「把已有能力接上」，而是**从零造一套 action → handler 映射**。这也是为什么上一轮把它列为「必须单独立项」——一次全量接线要覆盖 4 个组件、约 2/3 的按钮还没有定义。

### 本轮范围：只接 `node-hover`

用户在两个选项里选了「试试」，即按试点做。理由：
- `node-hover` 的 4 条定义**完全没有 UI 消费**，只有单测在断言，接上才算兑现
- 按钮少，失败只影响悬浮栏，不碰底部工具栏的 `Divider` / `activeStyle` / `getTipX` 那套特殊逻辑

**修正了原计划**：原打算接「复制 / 生成 / 取消 / 删除」四条。动手时发现 `ToolNodeContext` 只有 `kind / category / hasAsset / busy`，**没有 `type` 字段**，而「生成 / 取消」是按 image / video / text 分流的。要接就得改 domain 契约——属于为接表而改契约，不做。

最终接的是**与节点类别无关的三条**：`node-info`（新增）/ `node-duplicate` / `node-delete`。按类别分流的按钮留在组件里按类型渲染。

### 改动

| 文件 | 变化 |
|---|---|
| `src/lib/canvas/node-toolbar-actions.ts` | 新建。action → handler 映射，只服务悬浮栏，**刻意不写成通用 dispatcher** |
| `src/domain/tool/definitions.ts` | 新增 `node-info`；移除没人消费的 `node-generate` / `node-cancel` |
| `canvas-node-hover-toolbar.tsx` | `baseToolbarTools` 改为 `resolveToolbarTools("node-hover", ctx, prefs)` 驱动；图标按 id 从 `NODE_TOOL_ICON` 查（domain 不能放 JSX） |
| `project.tsx` | 补 `onDuplicate` / `onDelete` 两个 prop |

### 唯一的新增真能力：悬浮栏第一次读偏好

接表前悬浮栏完全不读 `intx-toolbar-prefs-node-hover-v1`，用户在设置里改的东西对悬浮栏无效。现在生效了。

```
IMAGE_TOOLBAR_LABELS: ["信息","复制这个节点 (Ctrl+D)","移除这个节点 (Delete)","上传图片"]
隐藏 node-duplicate 后: ["信息","移除这个节点 (Delete)","上传图片"]
HIDDEN_DUPLICATE_GONE: true / OTHERS_KEPT: true
HOVER_REGISTRY_PASS
```

### 验证

- `pnpm verify` 全绿：**68 文件 / 808 用例**（新增 6 条映射层用例）
- 十二组 E2E 全 PASS（新增 `hover_registry_check`）
- 结构预算压回基线：`project.tsx` 加 2 行 prop 后超 1 行，把两个 prop 并到一行抵消

### 顺带修掉的测试失真

- `toolRegistry.test.ts` 两条断言在测「生成 / 取消」，定义移走后改成测实际存在的行为
- `tool-wiring.test.ts` 的「applicable 不通过则不可见」换成 `node-info` 验证
- `delete_entries_check.mjs` 的选择器 `aria-label="查看节点信息"` 本来就不匹配（实际是 `infoTitle` 之外的 `info`），一直靠 `count()>0` 侥幸通过，现已改成 `aria-label="信息"`

### 剩下的债，说清楚不做

底部工具栏（约 18 个按钮，注册表 `main` 只有 6 条）与选区工具栏（11 条定义）仍未接。它们要么需要先补定义，要么依赖 `Divider` 分段 / `activeStyle` 高亮 / `getTipX` 跟随提示这些 `ToolEntry` 表达不了的交互。真要做，得先给这些交互设计表达方式，不是照搬悬浮栏的做法。

---

## 第十七轮：视觉基线对齐 BeefTV（2026-11-21）

### 找到了「审美不行」的具体原因

不是没有设计系统，是**用了两套**：

| 层 | 色相 |
|---|---|
| 应用外壳（shadcn 变量） | `oklch(x 0 0)` — 纯中性灰 |
| 画布色板 `canvas-theme.ts` | stone 暖灰 `#f4f2ed` / `#292524` / `#1c1917` |

从项目列表点进画布，整屏从冷灰变米黄。**这就是色调断层的来源**，跟组件写法无关。

上游 BeefTV 的画布是 `#f0f0f0` / `#141414` 中性灰，所以直接对齐它的值。

### 改动

| 文件 | 变化 |
|---|---|
| `src/lib/canvas-theme.ts` | canvas / node / toolbar 三组全部换中性灰；`placeholder` 有意高于上游（上游 #737373 在深色卡上仅 3.2:1） |
| `src/lib/app-theme.ts` | `dark.elevatedBg` 暖黑 → `#1c1c1c`；新增 `colorTextPlaceholder`（浅 `rgba(17,24,39,.55)` / 深 `rgba(255,255,255,.55)`） |
| `canvas-node.tsx` / `canvas-toolbar.tsx` / `canvas-top-bar.tsx` / `canvas-zoom-controls.tsx` | 暖调阴影 `rgba(28,25,23,α)` → 中性 `rgba(15,23,42,α)`，共 7 处 |
| `canvas-node.tsx` | 空节点占位三处统一：`text-[10px]`+`tracking-[0.18em]`+`opacity-50` → `text-xs`，图标 30/35% → 60% |
| `snapshot-storage-status.tsx` | 状态点由组件自带（绿/黄/红），6 处复用不再各写外壳 |
| `pages/canvas/index.tsx` | 「删除全部」加 `danger` + 两侧分隔线 |
| `canvas-top-bar.tsx` | 标题与状态之间加竖线 |
| `canvas-timeline-dialog.tsx` | 滚动容器加 `thin-scrollbar` |

### 纠正上一轮三条判断中的两条

**P0-1「时间线弹窗的添加字幕是白底下拉，深色主题漏改」——判断错了。**

实测（Playwright 读计算样式 + 局部截图）：下拉是深色底，从来不是白底。真正的问题是占位文字 `rgba(255,255,255,.25)`，等效对比度约 2.4:1，几乎读不出来。修法因此不是「补主题算法」，而是提占位色——已在 `app-theme` 全局 token 修掉，所有 antd 输入框一起受益。

**P1-2「底部两条浮动栏不是一套视觉」——不成立。**

实测两者已经是同一套：`h-14 rounded-xl border px-2 shadow-lg backdrop-blur` + 同一 `dockStyle` 对象。只有图标 `size-3.5` 与 `size-4` 的微差，不值得为此改结构。

**P0-2 / P0-3 / P1-1 / P1-3 属实**，已改。

### 验证

- `pnpm verify` 全绿：68 文件 / 808 用例；令牌、结构预算、边界均无回退
- 十二组 E2E 全 PASS
- 截图：浅色/深色各 7 张，存 `artifact/visual/`，改动前版本在 `artifact/visual-before/`
- 像素级复核：深色占位文字实渲染峰值 `#858585`（目标 `#8f8f8f` 的抗锯齿值），对比度 4.7:1

### 沉淀

新增 `docs/视觉基线-BeefTV.md`：色板、阴影、字号梯、圆角梯、对比度底线、已对齐/未对齐清单、复核命令。

后续视觉改动以它为准，不再每轮重新讨论「参考谁」。

### 仍然不做

- 上游 `frame` / `spatial` / `timeline` / `accent` 四组令牌：本项目无消费方，引入即死代码
- 上游三层令牌文件拆分：已有 `tokens.css`，拆开是无收益的结构改动
- 上游 1179 个前端文件整体移植：与本项目仅 79 个同名，早期同源后期各自演化，结构已不可直接搬

## 第十八轮：工具栏偏好可被用户修改（2026-11-21）

### 修的是「能配但不给配」

注册表早就有了 `resolveToolbarTools(toolbar, ctx, prefs)`，它会按 `prefs.order` 排序、过滤 `hidden` 与 `applicable`。但 `setPrefs` 全项目**零调用点**——偏好只能靠手改 localStorage，等于配好了门却没装把手。

这一轮装上把手。

### 改动

| 文件 | 变化 |
|---|---|
| `src/components/canvas/toolbar-prefs-modal.tsx` | **新建**。四组勾选（底部工具栏 / 多选浮动栏 / 节点浮动栏 / 节点右键菜单），每组独立「恢复默认」 |
| `src/domain/tool/definitions.ts` | 补齐 6 条缺失的 `main` 定义（`tool-image` / `tool-video` / `tool-text` / `tool-audio` / `tool-upload` / `tool-style`），`toolbar: 'main'` 从 6 条增到 12 条。不补的话清单里看不到这些按钮，等于「没法隐藏」 |
| `canvas-toolbar.tsx` | 加 `visibleIds` 门禁包裹 8 个按钮块 + extensions 块；外观面板底部加「自定义工具栏」入口；`ToolbarButton` 加 `data-toolbar-id` 便于 E2E 定位 |
| `locales/zh-CN.ts` / `en-US.ts` | 新增 `toolbarPrefs.*` 段 |
| `web/toolbar_prefs_check.mjs` | **新建**验收脚本 |

### 刻意只做显隐，不做排序

排序会让 `category` 分隔线（danger 区、extensions 区）在拖动时乱跳，得有专门的拖拽层才撑得住。当前价值不值这个复杂度，先不做。

偏好只写 localStorage，**不进项目文件、不参与撤销**——它是本机视图设置，不是文档数据。

### 验证

`toolbar_prefs_check.mjs` 实测：

```
TEXT_BTN_BEFORE: 1
GROUPS: ["画布底部工具栏","多选浮动栏","节点浮动栏","节点右键菜单"]
STORED_AFTER_UNCHECK: {"hidden":["clear-canvas","tool-text"], ...}
TEXT_BTN_AFTER_RELOAD: 0
TOOLBAR_AFTER_RELOAD: ["tool-pan","tool-undo","tool-redo","tool-image","tool-video","tool-audio","tool-upload","tool-style"]
STORED_AFTER_RESET: {"hidden":["clear-canvas"], ...}
ERRORS: []
TOOLBAR_PREFS_PASS
```

十二组 E2E 全量回归全 PASS（含本轮新增），确认 `visibleIds` 门禁没影响既有入口：

`registry_ui` / `p2_ui` / `p3_ui` / `context_menu_ui` / `create_menu_ui` / `snap_ui` / `text_ui` / `timeline_ui` / `undo_timeline_ui` / `menu_groups_check` / `delete_entries_check` / `hover_registry_check` / `toolbar_prefs_check`

`pnpm verify` 全绿：68 文件 / 808 用例；令牌 115（基线 145）；结构 3860（基线 3860）。

### 一个踩过的坑

脚本最初断言「在同一页面里勾掉 → 按钮立刻消失」，flaky：拿到 1 而不是 0，属 React 状态时序。用直接预置 localStorage 再进页面验证，`tool-text` 确实为 0，证明门禁生效。

所以断言拆成两步：**偏好有没有落盘** + **带偏好重进画布有没有消失**。不把两件真事混在一个 flaky 断言里。

### 注意：本机 git 元数据丢失

沙箱回收后 `/workspace/INTX-dev-new/.git` 消失，远程是私有仓库、凭据也不在了。**改动都还在磁盘上，但无法从本机提交**。恢复办法是重新 clone 后再把这些文件覆盖回去，或换一台有凭据的机器继续。

## 第十九轮：页面留白统一到 PageShell（2026-11-21）

### 问题不是「留白不够」，是「四个页面四种留白」

先量了四个主页面的内容左边界（1440×900）：

| 页面 | 修复前标题左边界 | 修复后 |
|---|---|---|
| 我的画布 `/canvas` | 144px | 168px |
| 我的资产 `/assets` | 144px | 168px |
| 任务中心 `/tasks` | **24px** | 168px |
| 配置 `/config` | **208px** | 168px |

切页时内容横向跳 184px，所以看着「没对齐」。根因是三套宽度各写各的：`canvas`/`assets` 用 `max-w-6xl`、`config` 用 `max-w-5xl`、`tasks` 干脆没写宽度容器、直接贴在 `px-6` 里面。

### 改动

| 文件 | 变化 |
|---|---|
| `components/layout/page-header.tsx` | `PageShell` 接管宽度与内边距：内层 `mx-auto w-full max-w-6xl px-6 py-5`；新增 `width="full"` 逃生口 |
| `pages/canvas/index.tsx` | 去掉 `px-6 py-5`、`mx-auto max-w-6xl` |
| `pages/assets/index.tsx` | 同上 |
| `pages/tasks/index.tsx` | 补上容器（原本没有） |
| `pages/config/index.tsx` | 同上，并去掉 `min-h-[calc(100dvh-13rem)]` |

**宽度为什么放 PageShell**：只要四个页面各自还能写 `max-w-*`，迟早又会出现第五种宽度。收进一处，下一个新页面默认就是对的。

**内边距为什么也放 PageShell**：先限宽再补内边距。反过来（外层 `px-6` + 内层居中限宽）会把两边 padding 再扣一次，内容比别的页窄一圈。

### 顺带修掉的空洞

配置页卡片用 `min-h-[calc(100dvh-13rem)]` 强行撑满视口，而实际内容只有 340px——卡片高 692px，下方空了 460px 无信息区域。

改成由内容撑开：卡片高度 **692px → 261px**。表格类界面撑满是有意义的（好放分页），配置表单撑满只是把空白框起来。

### 验证

- 四个页面左边界实测均为 **168px**
- `pnpm verify` 全绿：68 文件 / 808 用例
- 令牌 115（基线 145）；结构 3860（基线 3860）
- `delete_entries_check` / `menu_groups_check` / `toolbar_prefs_check` 三组涉及页面容器的 E2E 全 PASS

### 一个观察

Playwright 设 `colorScheme: 'light'` 截图仍是深色——本项目主题由 store 决定，不跟系统偏好。以后要验浅色得先切 theme store，不能只改 context 的 colorScheme。

## 附：干净克隆暴露的构建阻断（同日修）

把改动搬到干净克隆里跑第一次验证，`pnpm typecheck` 直接失败：

```
src/pages/canvas-flow-pilot/index.tsx(26,8): error TS2307:
Cannot find module '@xyflow/react' or its corresponding type declarations.
```

**原因**：`@xyflow/react` 从没写进 `package.json`。本地能跑，是因为某次实验在
`node_modules` 里留下了一份（13.0.2），typecheck 顺着磁盘找得到。干净环境
`pnpm install` 之后没有这个包，构建立刻断。

**这不是本轮引入的**——`/canvas-flow-pilot` 页面和路由（`router.tsx:27`）都在
`55fb618` 里，只是从来没人从零装过一次。

**修法**：`package.json` 加 `"@xyflow/react": "^13.0.2"`，`pnpm-lock.yaml` 同步。

修完在干净克隆里 `pnpm verify` 全绿：**72 文件 / 864 用例**（比本地 68/808 更多，
说明本地反而漏跑了几个文件）。

**教训**：本地 `node_modules` 是不可信的。凡是「依赖能不能装上」这类问题，
只有在干净克隆里才能验出来——这次的 tar 包搬运反而顺手证明了这一点。

## 第二十轮：三处「导入」拆名字（2026-11-21）

### 原本以为要「3→2 删一个」，读完代码发现不该删

一直挂着的「导入收敛 3→2」，动手前先把三处入口的实际行为查了一遍：

| 入口 | 文案 | 实际行为 |
|---|---|---|
| 画布顶栏 → 文件 → 第 1 项 | 「导入资产」 | 选图片/视频/音频 → 在画布上建节点 |
| 我的资产页 `/assets` | 「导入资产」 | 选 zip → 解压进资产库 |
| 我的画布页 `/canvas` | 「导入画布」 | 选 zip → 还原一份画布 |

**三个功能都是真需要的**，问题不在数量，在**名字打架**：

顶栏那条标着「导入资产」，点开却是选图片建节点，跟资产库毫无关系。
它还能放视频和音频，叫「资产」本身就不准。用户看到两个「导入资产」，
一个往库里去、一个往画布上放，只能靠试。

### 改法：改名，不删功能

| 文件 | 变化 |
|---|---|
| `locales/zh-CN.ts` | 删 `canvas.importAsset`，新增 `canvas.importMedia: "放入媒体文件"` |
| `locales/en-US.ts` | 同上，`"Place media files"` |
| `canvas-top-bar.tsx` | 菜单第 1 项改指 `canvas.importMedia` |
| `menu_groups_check.mjs` | 加断言 `IMPORT_LABEL_OK`，防止改回旧名 |

删掉 `canvas.importAsset` 是因为我的改动让它变成零引用的死键——只删自己造成的孤儿。

### 为什么不做「入口 3→2」

唯一看似可合并的是顶栏那条和「插入工作流」——两者都是「往画布放东西」。
但一个是放用户本地媒体、一个是放存好的工作流，选择器和后续行为完全不同，
合并会让用户多点一次才能表达清楚意图。**为减少一个菜单项牺牲明确性，不划算。**

### 验证

- 临时探针实测（未入库）：菜单文本里 `放入媒体文件` 存在、`导入资产` 消失
- `menu_groups_check.mjs`：`IMPORT_LABEL_OK: true`，13 项其余不变
- `pnpm typecheck` 通过；`pnpm verify` 72 文件 / 864 用例全绿

### 一句自我提醒

这条挂了三轮没动，是因为我一直在等「砍哪个」的答案。真去读代码才发现前提是错的——
**不是入口太多，是名字重复**。以后遇到「要不要砍掉重复项」的问题，
先查清每项的实际行为，别急着做减法。

## 第二十一轮：插件市场第一次真的有插件（2026-11-21）

### 两个开关一开，整条链路就通了

上一轮把代码侧做完，卡在两个我按不了的地方：仓库私有、token 缺 workflow 权限。
用户把两者都开了之后：

| 动作 | 结果 |
|---|---|
| token 补 Workflows 权限 | `da07994` 推送成功（之前被 `refusing to allow ... without workflow scope` 挡住） |
| 仓库转公开 | `private: false`，jsDelivr 立刻 200 |

### 端到端实测（这是第一次真正跑通）

以前只能说「分支推上去了」，现在能说「用户点了安装，插件真的能用」：

```
REGISTRY_URL_OK: true
REGISTRY_HTTP: 200
PLUGINS_LISTED: 5 ["Markdown 节点","SVG 节点","HTML 节点","3D 全景节点","便利贴节点"]
INSTALL_BUTTONS: 5
PLUGIN_JS_SERVED: [{"name":"markdown.js","status":200}]
INSTALL_TOAST: true
INSTALL_BUTTONS_AFTER: 4 (应比安装前少 1)
PLUGIN_REGISTRY_PASS
```

关键在 `markdown.js => 200` 和 `INSTALL_BUTTONS_AFTER: 4`：点了安装之后
CDN 真的把插件 js 送来，按钮真的从「安装」变成已安装态。不是只看清单拉到了。

界面上也改了文案：从「来自仓库注册表」变成**「本项目官方插件，来自仓库注册表」**，
不再暗示这是别人的东西。

### 新增 `web/plugin_registry_check.mjs`

把这条链路固化成脚本，盯三件事：
1. 清单请求打到自己仓库的地址（不是上游），且 200
2. 五个官方插件都列出来，每项都有安装按钮
3. 点安装真的下载 js、按钮变成已安装态

**特意把「清单 404」和「代码坏了」分开报**：脚本会输出 `REGISTRY_HTTP: 404`，
一眼看出是仓库又变回私有了，而不是去翻代码。

### 一个反复出现的环境问题

TLS 连接在这台机器上不稳，`push` / `curl` 时不时报
`GnuTLS recv error (-110): The TLS connection was non-properly terminated`。
重试即可，但**重试逻辑本身写错过一次**：我用 `git push | tail -4` 然后看退出码，
`tail` 的退出码永远是 0，把「推送失败」当成了「推送成功」。
正确写法是把输出存进变量再用 grep 判断关键字。

### 验证

- `plugin_registry_check.mjs` 全部断言 PASS
- `pnpm verify`：72 文件 / 864 用例全绿
- 5 个插件 js 全部 200，字节数与构建产物一致

## 第二十二轮：两个 npm 包发布到自己的 scope（2026-11-21）

### 从「卡在账号」到「实测能装」

品牌清单里最后 2 项一直标着「缺 npm 账号」。账号拿到之后，实际做的事比预想少：

| 动作 | 结果 |
|---|---|
| `@basketikun/canvas-proxy` → `@supenman/canvas-proxy` | `npm publish` 成功，0.1.0 |
| `@basketikun/canvas-agent` → `@supenman/canvas-agent` | `npm publish` 成功，0.6.0（43 文件，48KB） |

改名的文件 8 个：两个 `package.json`、两个 `README.md`、前端两处引导文案、
`canvas-agent/src/version-check.ts` 的版本检查地址、以及注释里提到上游的那一行。

### 端到端实测（只看 publish 成功不算数）

```
$ npx --yes @supenman/canvas-proxy@0.1.0
@supenman/canvas-proxy v0.1.0 listening on http://127.0.0.1:23210
Fill this address into Infinite Canvas → 配置 → 本地代理: http://127.0.0.1:23210

$ npx --yes @supenman/canvas-agent@latest
Infinite Canvas Agent
INFO Canvas Agent version version='0.6.0'
Local URL: http://127.0.0.1:17371
INFO Canvas Agent started
```

两个包都是**从官方 registry 新下载的**，不是本地那份。agent 的 `/health` 也回了。

### 一个吓人的假象：索引同步延迟

发布返回 `+ @supenman/canvas-proxy@0.1.0` 之后，接下来 **近 3 分钟**里：

```
registry.npmjs.org/@supenman%2fcanvas-proxy  → 404
npx @supenman/canvas-proxy@0.1.0             → 404
```

一度怀疑是 scope 没建好或包被限制成私有。真正确认发布成功的是这条**反向证据**：

```
$ npm publish
npm error 403 You cannot publish over the previously published versions: 0.1.0.
```

能报「不能覆盖已发布的 0.1.0」，说明 0.1.0 确实在 registry 上——只是 metadata
索引还没建好。约 5 分钟后两个包都返回 200。

**记住这个判据**：`npm publish` 报 `cannot publish over previously published versions`
= 包存在。比等 metadata 刷新可靠。

### 顺带发现：沙箱默认走了腾讯镜像

`npx` 默认请求 `mirrors.tencent.com/npm/`，新发布的包在镜像上必然 404。
测试新包要显式加 `--registry=https://registry.npmjs.org`，否则会误判成发布失败。

### 验证

- agent 单测：**81 pass / 0 fail**
- `web` 类型检查通过；`canvas-agent` 类型检查通过
- 两个包 tarball 均从官方 registry 下载成功

### 界面上同时做了的事：撤掉文档入口

`docs/` 的 Fumadocs 站点能构建（中英双语 37 页），但不打算上线。
原来右上角「文档」图标指向 `docs.canvas.best`——**上游作者的站点**，用户点进去读别人的文档。

已摘掉：`user-status-actions.tsx` 的书本图标、`topNav.docs` 文案键、`canvas-top-bar.tsx`
里未使用的 `DOCS_URL` 导入。`DOCS_URL` 默认值改为空字符串并留了注释：
将来部署后设 `VITE_DOC_URL` 再把图标接回来。

`canvas.docs` 那个键更早之前就已零引用（不是这轮造成的），没动。

## 第二十三轮：npm 发布改走 OIDC（2026-11-21）

### 补上元数据缺口

上一轮发布的包在 registry 上是**裸的**——`repository` 字段为空。npm 页面上不会显示
「来自哪个仓库」，用户也没法点回源码核实。两个包各补一条：

```json
"repository": { "type": "git", "url": "git+https://github.com/Supenman/INTX.git", "directory": "canvas-agent" }
```

`canvas-agent` 原本的 `description` 为空，一并补上。这是**只对下次发布生效**的改动，
已发布的 0.6.0 / 0.1.0 不会追溯。

### 新增 `publish-npm.yml`：不存 token 的发布方式

| 设计点 | 选择 | 为什么 |
|---|---|---|
| 认证 | `id-token: write` + Trusted Publishing | 凭据随 job 失效，泄漏无从谈起 |
| 触发 | `release: published` / `workflow_dispatch` | 不在每次 push 时发，避免版本号被日常提交拖着走 |
| tag 校验 | tag 与 `package.json` 版本不一致就失败 | tag 是外部可见的声明，package.json 是实际发出的内容，不一致比失败更难排查 |
| npm 版本 | job 里 `npm i -g npm@latest` | Trusted Publishing 需要 npm 11.5+，node 22 自带 10.x |

比上一轮还多一步：发布前跑 `npm ci && npm test`，agent 的 81 个用例不过就不发。

### 为什么绕开 token 是必须的，不是洁癖

npm 在 2025-11 把 classic token 全部**永久吊销**（不可重建、不可恢复）。现在只剩
Granular，而其中带 bypass 2FA 的直接发布权限 **2027-01 起移除**，改为
「暂存 + 人工批准」。也就是说上一轮那种发法有明确寿命。现在接 OIDC，一次到位。

### 还差用户点一下

两个包页面上各绑一次 Trusted Publisher（GitHub Actions / Supenman / INTX / `publish-npm.yml`）。
步骤写在 `docs/品牌去上游-发布清单.md` 附四。绑完就能用 Release 发版。

## 第二十四轮：CI 一直是红的，两条都是 pnpm（2026-11-21）

### 起因

推完 npm 相关改动后习惯性看了一眼 `gh run list`，发现：

```
failure | Verify            | 79b658c
failure | UI Overflow Check | 79b658c
```

两个 job 都报同一句：

```
x.sh: line 1: pnpm: command not found
```

**在此之前一直是红的，只是没人看。** 这也解释了为什么「本地 `pnpm verify` 全绿」
和「CI 绿」对我一直是两件事。

### 两个不同的根因

| 工作流 | 原本怎么装 pnpm | 为什么失败 |
|---|---|---|
| `verify.yml` | **完全没装**（有 setup-bun，但 bun ≠ pnpm） | 直接 command not found |
| `ui-overflow.yml` | `corepack enable` | job 的 `working-directory` 是 web，corepack 读不到 `web/package.json` 的 `packageManager`，shim 没生成 |

### 修法用了同一个模式

```yaml
- uses: pnpm/action-setup@v4
  with:
    package_json_file: web/package.json
```

**特意不写 `version: 10.28.2`**，让它读 `web/package.json` 的 `packageManager` 字段
（值 `pnpm@10.28.2+sha512...`）。写死一处就多一处要同步的地方，升级 pnpm 时必忘。
`checks.yml` 里本来就是写死的，这次没动它——不在本轮范围内。

### 第二个坑：步骤顺序

修完 verify 后 ui-overflow 仍报 `Unable to locate executable file: pnpm`，
但这次是 **setup-node 自己报的**：

```yaml
- uses: actions/setup-node@v4
  with:
    cache: pnpm        # ← 这一行让 setup-node 去找 pnpm
```

`cache: pnpm` 需要 pnpm 已在 PATH 上才能算缓存目录。所以顺序必须是
**pnpm/action-setup → setup-node(cache: pnpm)**，不能反。已加注释说明。

### 结果

```
success | Checks            | cb45405
success | UI Overflow Check | cb45405
success | Verify            | 6aa3cbe
```

`cb45405` 只改了 `ui-overflow.yml`，不触发 verify 的 paths 过滤，所以最新
Verify 跑在 `6aa3cbe` 上——那个提交含 verify 的修复，success。

### 教训

**本地全绿不等于 CI 绿。** 这轮之前我一直用「`pnpm verify` 全绿」作为完成判据，
但 CI 跑的是另一套安装流程，它坏了两周也没人知道。以后推完先看 `gh run list`，
而不是只看本地。

## 第二十五轮：OIDC 真通了，卡在两处不是 OIDC 的坑（2026-11-21）

用户勾上 `Allow npm publish` 后，第一次重跑仍 403：

```
npm error 403 - OIDC permission denied for this action
```

这行和「没勾」时的报错一字不差，但此时勾已经生效了。**这行错误不能单独
拿来判断勾没勾**——本轮两次都报它，只有第一次是勾的问题。

### 重跑不需要 Actions 权限

`gh run rerun --failed` 和 `gh workflow run` 都要 Actions: write，当前 PAT
没有、也不想再加一个权限。改用**草稿翻转**重新触发 `release: published`：

```bash
gh release edit <tag> --draft=true
gh release edit <tag> --draft=false
```

只要 contents: write 就够。tag 不动、release 不删、notes 不丢，等价于
「重新发布一次」。之后 `gh run list` 会冒出新的 run。

### canvas-agent 的两处坑（都与 OIDC 无关）

第一处，`npm ci` 报 EUSAGE：

```
Missing: @openai/codex@0.146.0 from lock file
Missing: @esbuild/win32-x64@0.28.1 from lock file   ← 全是 optional 平台包
```

lock 里缺了 optional deps 那批平台包。本地 `npm install --package-lock-only`
补齐（+552 行）。

第二处更隐蔽，补完 lock 才暴露：

```
npm error code EALLOWREMOTE
npm error Refusing to fetch "@openai/codex@http://mirrors.tencent.com/npm/..."
```

**沙箱默认走腾讯镜像，`npm install` 会把镜像地址写进 `resolved`。** 32 条
`http://mirrors.tencent.com/npm/` 直接提交上去，CI 拒绝非加密源，报的却是
"packages of type remote disabled"，看着完全不像镜像问题。

改回官方源后先在干净目录验一遍再推：

```bash
mkdir /tmp/agent-ci && cp package.json package-lock.json /tmp/agent-ci/
cd /tmp/agent-ci && npm ci --ignore-scripts --registry=https://registry.npmjs.org
```

6 秒装完 148 包，说明 `resolved` 与 `integrity` 对得上，不是硬改字符串骗过检查。

### 结果

```
@supenman/canvas-proxy  0.1.0 → 0.1.1   provenance: slsa.dev/provenance/v1
@supenman/canvas-agent  0.6.0 → 0.6.1   provenance: slsa.dev/provenance/v1
```

两个包 `dist-tags.latest` 都指到新版本，`npx` 实跑通过（proxy 打印用法，
agent 起在 17371 并打出 connect token）。全程没有任何 npm token 参与。

### 教训

**发布链路的失败要分层看**：OIDC 403、lock 不同步、镜像地址污染，三者都
表现为「publish 这一步红了」。先 `gh run view --log-failed` 看第一行真错，
不要拿最后那行 `npm error` 当结论。

## 第二十六轮：M2 收尾两条，用拦截式浏览器实测闭环（2026-11-21）

HANDOFF「接下来」里挂的 M2 剩两条是 `M2-真机验收清单-2026-11-16.md` 的
场景 C（C1–C4 出网方式）和「台账不含 Key」。清单把它们列成真机项，但其中
**「请求到底发往哪个 URL」和「本机台账写了什么」可以在浏览器里实测**，
不必用真 Key、不必发真实厂商请求。

新增独立脚本 `web/m2_egress_check.mjs`：Playwright 拦截所有发往
`api-inference.modelscope.cn` 或本地代理的请求，直接回 401；只记录请求 URL，
再从 IndexedDB 扫台账。假 Key 字符串写死在脚本里（`TEST-KEY-DO-NOT-USE`），
不是任何真凭据。

| 用例 | 设置 | 期望 | 实测 URL 前缀 | 判定 |
|---|---|---|---|---|
| C1 | system + 代理开 | 走代理 | `http://127.0.0.1:23210/https://api-inference...` | ✅ |
| C2 | direct + 代理开 | 直连 | `https://api-inference.modelscope.cn/...` | ✅ |
| C3 | system + 代理关 | 直连 | `https://api-inference.modelscope.cn/...` | ✅ |
| C4 | 老配置无 `proxyMode` + 代理开 | 走代理 | `http://127.0.0.1:23210/https://api-inference...` | ✅ |

四例都拿到 `GenerationTaskError` / `auth_failed`，文案是「鉴权失败，请检查 API Key
配置」，无上游任务号。这与单测里的三态判定一致。

台账扫描：四条任务都真实写入（`intx_task_log` 字节数 603 → 1128 → 1653 → 2178），
对 `TEST-KEY-DO-NOT-USE`、BaseURL 明文、`data:image` 三个特征串扫出 **0 命中**。
页面错误 0。

### 边界（不要写成已验证）

- **没发真实厂商请求**：上游是 401 mock，所以「真实网络下 C2 会因 CORS 预检失败」
  这条现象没验，那是真机 / 桌面版才能看的网络表现。
- **扫的是本地注入场景的台账**，不是用户机器上的真实台账。用户若要核对自己的，
  在任务中心导出诊断 JSON 后搜 Key 前缀与 BaseURL 即可。
- 场景 A/B（真实出图、三类失败路径）本就不在这两条里，维持原有记录。

## 第二十七轮：生成结果去重——复核后确认不需要加层（2026-11-21）

BeefTV 精读清单 §1 留的一条 ⬜ 是 `applyGenerationConsumerEffect` /
`generationEffectApplied`：它用一次性标记防止同一结果被重复消费（轮询与
重试并发时重复挂产物）。本轮决定**不加**，理由是现有架构三条已经挡住：

1. **命令式 await，没有 effect 驱动的自动 attach**。`requestSingleImage`
   的结果由调用方直接挂节点，不存在 React effect 响应 task 状态变化而重跑
   的路径。BeefTV 那个坑的前提在我们这里不成立。
2. **UI 全局锁**：`config-tasks.tsx` 的 `busyId` 让同一标签页的取回串行；
   `inFlight` Set 再按任务号挡一层。
3. **跨进程幂等**：`commitRecoveryAtomically` 在事务内做 revision 条件更新，
   `planDraftRecovery` 按素材 id / storageKey 复用已落盘产物。两路同时取回
   时只有一路能核销，另一路整体回滚，不会留下「素材已挂、任务没核销」。

新增回归测试 `src/infrastructure/storage/atomic-commit.test.ts`：
「同一任务被两路并发消费：只有一边核销，产物不重复挂」。成功标准写死为
——`Promise.all` 两路相同输入，恰好一路 `ok`；任务 revision 只 +1；素材
快照里新产物恰好一份。实测通过。

`pnpm verify` 全绿：72 文件 / **865 用例**（比上轮多 1），门禁不变。

### 边界

- 跨标签页同时取回时，两边都会先 `uploadImage` 写媒体文件，失败那边的
  媒体文件会成为孤立文件（素材快照回滚了，文件没回滚）。这不影响产物重复
  挂载，也不影响台账正确性；要消除得引入跨标签页协调，成本大于收益，**不做**。
- 若将来把挂产物改成 effect 驱动（监听 task 状态自动 attach），届时必须补
  一次性消费标记——本轮的结论只对当前命令式架构有效。

## 第二十八轮：画布框选批量导出（2026-11-21）

BeefTV 精读清单 §3 剩三条 ⬜（120ms 错峰 / fetch→blob→objectURL / 返回成功失败）
终于落地。但落地方式不是照抄，清单里的判断标准是「**目的**要不要保，不是手段
要不要抄」。

### 为什么是 zip，不是逐个下载

BeefTV 是纯网页，交付路径就是连续触发浏览器下载，所以它的三个绕坑手段是被
环境逼出来的。我们是桌面应用：`saveFile` 每调一次弹一次系统「另存为」，10 张
图 = 10 次确认；Tauri WebView 里连续 `a.click()` 没有下载管理器兜底。所以：

```
框选 ≥2 个节点 → 浮栏「批量下载」→ 取字节 → 打成一个 zip → 弹一次对话框
```

- 只下载一次 → 不存在「连续下载被拦截」，120ms 错峰没有意义；
- 字节直接进 zip → 不存在 objectURL 生命周期，revoke 也不用写；
- 部分失败照样出包 → 三条的**目的**全保住。
- 复用已真机验过的 `dialog:allow-save` + `fs:allow-write-file`，**没有新增任何
  桌面权限**。这也是不选「选目录写 N 个文件」的原因：那要 `dialog:allow-open`
  加目录 fs scope，改 Rust 侧能力声明，本环境无法验证。

### 改动

| 文件 | 作用 |
|---|---|
| `src/domain/asset/batch-export.ts` | 纯函数：挑可导出节点、按画布坐标排序、`01_标题.png` 命名、逐条取字节并单独汇报失败 |
| `src/hooks/use-batch-export.ts` | 执行层：读取 → `createZip` → `saveFile`；单文件时直接存图片本体 |
| `src/components/canvas/canvas-selection-toolbar.tsx` | 浮栏加「批量下载」，按注册表决定显隐，无媒体时灰掉；「保存工作流」图标从 `Download` 换成 `FileDown`（两个下载类图标挨着会认错） |
| `src/domain/tool/definitions.ts` | 注册 `download-selection`（selection / edit / order 107） |
| i18n 中英 | `canvas.batchExport.*` 七条 |

`buildExportFileName` / `sortForExport` 从「有单测没调用方」变成真正在用。

### 验证（都是跑出来的）

单测 `src/domain/asset/batch-export.test.ts` 8 条：乱序坐标 → 01/02/03、混文本
节点断号不出现、12 张时补零宽度跟着总数、`封面/终稿` → `封面 终稿`、`CON` →
`未命名_CON`、扩展名优先 mimeType、单条读取失败不影响整批。

端到端 `web/batch_export_check.mjs`（真浏览器、真上传、真下载）：

```
NODES: 2
BUTTON: 批量下载（2 个）
DOWNLOAD_NAME: canvas-export-20261121-1415.zip
ZIP_ENTRIES: ["01_封面.png","02_内页.png"]
ZIP_SIZES: {"01_封面.png":70,"02_内页.png":79}
TOAST: {"done":true,"matched":"已导出 2 个文件"}
PAGE_ERRORS: []
```

包内字节数与上传原图一致（70 / 79 字节），证明不是空壳条目。

`pnpm verify` 全绿：73 文件 / **873 用例**（上轮 865，+8），令牌 115、结构预算
3860 均未变。

### 边界

- **只验了浏览器通道**（file-saver）。桌面「另存为」弹窗那一段要在真机点：
  默认名 `canvas-export-<日期>-<时分>.zip`，取消不提示、写盘失败报错，这两条
  与既有「另存为」共用同一条链路（第一轮真机验过），本轮没有重验。
- **跨域图片会失败**：远程 `https://` 素材若不给 CORS 头，`fetch` 拿不到字节，
  该条进失败清单，其余照常出包。不绕过——绕过等于把用户的图送到第三方代理。
- 排序在浏览器检查里只能验「与上传顺序一致」，因为节点由程序摆放；真正的
  坐标排序由单测覆盖（人工拖动后再导出没跑过）。

## 第二十九轮：时间线/故事板复核遗留的 5 条（2026-11-21）

接着批量导出之后，把 11-20《时间线 / 故事板 / 链路复核》里「仅记录、未动」
的条目逐条核了现状。按清单第 9 节的三问走：**它踩过什么坑 → 是不是纯函数 →
我们是否已经天然避开**。结果五条都还活着（其中一条的现象描述已过期），全部修掉。

| 条目 | 现状核对 | 本轮处理 |
|---|---|---|
| P1-5 音频比画面长 | 文档写「末帧定格」，但现行帧循环每帧都清黑底、`clipAtSeconds` 空档返回 null，**定格现象已经不存在**；剩下的真实问题是「尾部凭空黑屏，用户以为导出截短了」 | 不加「重复最后一帧」，只在导出前给准确提示：`音频比画面长 N 秒，尾部画面会是黑屏，声音继续`（中英） |
| P2-7 镜号与画布 x 混排 | `fromLegacyNodes` 里 `(timelineOrder ?? position.x)` 确实还在；旧数据迁移专用 | 分两段：有镜号的按镜号排，没镜号的按 x 接在后面。补回归测试：x=10 的无编号镜头不得插到镜号 1/2 前面 |
| P2-9 导入 zip 无上限 | `readZip` 仍直接 `unzipSync`，外部工作流包是入口 | 新增 `assertZipBudget`：只读中央目录（解压前）累加原始大小，512 条目 / 512MB 上限，ZIP64 明确拒绝；解压后再核一次实际字节。5 条单测含「小包声明 600MB」 |
| P2-11 故事板列数脱钩 | `shots` 变量算宽度，下面却写死 `% 2` / `/ 2` | 统一为 `columns`，宽度与行列计算同源。当前列数仍是 2，行为不变，但以后改列数不会错位 |
| P2-12 writer 未取消 | `finally` 只 dispose 输入与 revoke objectURL | 加 `finalized` 标志；未 finalize 时 `await output.cancel()`，取消失败吞掉以免盖住原始异常 |

### 验证

`pnpm verify` 全绿：74 文件 / **879 用例**（上轮 873，+6），令牌 115、结构
预算 3860、依赖边界均未变。`tsc` 0 错。

### 边界

- **P1-5 的提示只在导出前弹**，没做「把最后一帧重复写满尾部」——那会凭空
  造出用户没提供的画面，比黑屏更糟。
- **zip 上限是 512MB / 512 条目**，比任何正常项目都宽裕；超过的合法大包会被
  拒，这是有意的取舍（内存打满比拒绝导入更难排查）。ZIP64 直接不支持。
- **P2-12 只做了静态核对 + 类型检查**：mediabunny 的 `Output.cancel()` 确实存在
  （`node_modules/mediabunny/dist/modules/src/output.d.ts:338`），但「编码中途抛错
  后 writer 真的被正确回收」需要真跑一次失败导出才验得了，本轮**未做真机导出**。
- **P2-7 只覆盖旧数据迁移路径**，新时间线模型的排序不走 `fromLegacyNodes`。

## 第三十轮：B1 版本对比（2026-11-21）

按 BeefTV 三问核对后只搬两条结论：**快照剥运行态字段**、**原地重生成保留稳定节点 ID 并建版本族**。
没有复制 BeefTV 的整段实现，也没有给它引入新的任务字段——INTX 自己的运行态是
`status / errorDetails / retryBlocked / videoTaskId / videoTaskProvider / primaryImageId / images[].status`。

### 改动

| 文件 | 作用 |
|---|---|
| `src/domain/node/media-version.ts` | 纯函数：版本族根 ID、A–Z 标签分配、剥运行态字段的快照、版本列表、设主版本、副本清版本关系 |
| `src/domain/node/media-version.test.ts` | 7 条：首次 A→B、再次升 C、批次图状态归一化、空节点不产快照、跨版本族标签不串、根节点被删仍可列版本、副本清字段 |
| `src/types/canvas.ts` | `CanvasNodeMetadata` 增加 `versionOfNodeId / versionLabel / versionPrimary` |
| `src/pages/canvas/project.tsx` | 图片节点原地重生成前调 `prepareMediaGenerationVersion`：旧图存为偏移 +36 的快照，当前节点升版；重复/复制时清版本字段；接版本对比弹窗 |
| `src/components/canvas/canvas-version-compare-modal.tsx` | A–Z 版本卡片：模型 / 尺寸 / 提示词、设为主版本、点预览定位画布 |
| `src/components/canvas/canvas-node.tsx` | 有版本标签的节点左上角显示版本徽标，点开对比；结构预算通过压缩既有 JSX 抵消，未涨基线 |
| i18n 中英 | `canvas.versionCompare.*`、`canvas.node.versionBadge/openVersions` |
| `web/version_compare_check.mjs` | 浏览器端到端：注入 A/B 两版 → 点徽标 → 弹窗两卡 → 切主版本 → 点预览定位 → 零页面错误 |

### 验证（都是跑出来的）

`pnpm verify` 全绿：**75 文件 / 886 用例**（上轮 74 / 879，+1 文件 +7 用例），
令牌 115（基线 145）、结构预算 3855（基线 3860，**比上轮少 5**）、依赖边界 0 违规。
`vite build` 通过（13.8s）。

`version_compare_check.mjs` 实测：

```
BADGES: 1 1
MODAL_CARDS: 2
MODAL_HAS_PROMPTS: true true
PRIMARY_SWITCHED: true
MODAL_AFTER_FOCUS: 0
ERRORS_TOTAL: 0 []
```

截图：`/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d6b-eb5a2a90b000/probe/version_compare_modal.png`。

### 边界

- **本轮只接图片节点的原地重生成**；视频/音频的纯函数已支持，但 UI 入口与真实重生成路径未接。
- **快照保存在原节点旁 +36px**，数量多时会有视觉重叠；这是 BeefTV 的既定取舍，先不引入自动排版。
- **版本标签封顶 Z**；从 Z 继续生成不会再升标签，避免制造非法标签。真要更多版本需要另行设计编号。
- 端到端检查注入了带版本字段的项目，**没有真 Key、没有真出图**；真生成后快照是否按预期写入，仍是 A1 那类真机证据。

## 第三十一轮：全站 UI 对照 BeefTV 复查（2026-11-21）

用户问「能不能先把 UI 向 BeefTV 对齐」，选了「全站复查对齐」范围。先按纪律盘点：78 个同名文件里已对齐核心色板/阴影/对比度（第十七轮），剩下真正能**安全**对齐的不多——大部分差异是架构性的，照搬会引入死代码。

### 盘点结论（哪些搬、哪些不搬）

| 差距 | 性质 | 处理 |
|---|---|---|
| 主题切换器缺并发锁 / reduced-motion 降级 / ViewTransition 异常兜底 / 动画引用回收 | BeefTV 踩过的真坑，纯 JS | ✅ 对齐 |
| 版本对比弹窗宽度偏窄、卡片偏窄、主版本无外发光、按钮无主次 | 纯视觉细节 | ✅ 对齐 |
| `globals.css` 2 万行 `app-workspace-*` 语义类 | 架构差异，INTX 用 Tailwind 原子类 | ❌ 搬了全是死 CSS |
| `canvas-theme` 的 frame/spatial/timeline/accent 四组 | 无消费方 | ❌ 文档已记录有意不引 |
| antd `controlTheme` 全套 | INTX 用 `darkAlgorithm` 自动生成 | ❌ 手写值会变死值 |
| 主题切换的 `data-canvas-world-layer` / `data-theme-switching` 降级 | INTX 没有这个 DOM 标记和 CSS | ❌ 照搬即死代码，没搬 |

### 改动

| 文件 | 作用 |
|---|---|
| `src/components/ui/animated-theme-toggler.tsx` | 模块级 `themeTransitionInFlight` 并发锁 + `themeClipAnimation` 引用；当前主题从 DOM 读不用闭包 state；`prefers-reduced-motion` 直接切；`startViewTransition` try/catch 兜底；`cleaned` 幂等 + 锁释放 |
| `src/components/canvas/canvas-version-compare-modal.tsx` | 宽度 1120→1180 / 卡宽 280→328；主版本加外发光 `0 0 0 2px toolbar.activeBg`（引用令牌不写死）；图片区 h-48→h-52；提示词 line-clamp 4→5；未设主版本按钮 type=primary 高亮 |
| `web/theme_toggle_check.mjs` | 浏览器端到端：连点 5 次不卡中间态、dark/colorScheme/图标一致、reduced-motion 立即翻转无 VT 残留 |

### 验证（都是跑出来的）

`pnpm verify` 全绿：**75 文件 / 886 用例**（与上轮持平），令牌 115（基线 145）、结构预算未涨、边界 0 违规。`vite build` 通过。
`theme_toggle_check.mjs`：`A_VT_CLEANED / A_STATE_CONSISTENT / A_ICON_MATCH / B_IMMEDIATE_FLIP / B_NO_VT` 全 true，页面错误 0。
`version_compare_check.mjs`：两卡、提示词、切主版本、定位全绿，错误 0。

### 边界

- 主题切换的「画布场景降级」没搬：INTX 没有 `data-canvas-world-layer` 标记，搬了不会触发。若后续要给画布加无动画切换，需先加标记 + CSS 规则，另算一轮。
- 本轮是视觉/交互对齐，没碰功能路径；真机观感（连点手感、主版本描边在浅色下的对比度）仍属 A 类真机证据。
