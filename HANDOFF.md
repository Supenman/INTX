# HANDOFF

> 起点：`dev` @ `76a6f2c`，已推送。工作区干净。**以此为准，别照旧文档找生图入口。**

## 现状

- **无待改代码任务。** 生图入口统一在节点提示词面板（`web/src/components/canvas/canvas-node-prompt-panel.tsx`）；「生成配置」节点、首页、`/prompts`、移动端布局均已下线；本地 Agent 为 opencode 单车道。
- 本轮修复（`76a6f2c`）：矮窗口下节点面板先压输入框高度（默认 160px、最少 76px），压到最小才上移。1280/1366 的「生成」按钮恢复可点，1440/1920 不变。用户认可，等对齐 BeefTV 时再看细节。
- 基线全绿：web tsc 0 错 / tokens 145 / boundaries OK / build OK / overflow 1280-1440-1920 无溢出 / vitest src 752；canvas-agent 单测 76/76、tsc 0 错。

## 接下来

1. **真机验收**（只能人做）：节点面板真实生图（用户说后面再测）；36px 手感与裁切手柄、面板压缩手感（随 BeefTV 轮一起看）；1280/1440/1920 观感；**Tauri 桌面渲染——现有 release exe 是 11-16 构建，不含本轮改动，要验需先 `tauri build --no-bundle`**（不装 MSI/NSIS）。
2. 可选：剩余 145 处裸值按基线只降不增，`npm run check:tokens` 把关。
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
