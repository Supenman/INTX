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
