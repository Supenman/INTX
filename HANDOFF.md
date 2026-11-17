# HANDOFF — 接手必读（当前状态）

> 交接对象：Claude（下一任接手者）
> 起点：`dev` @ `983008b35a5a0ddb055693345e0b43e25409307f`，本地工作副本已逐文件对齐远端（85 修改 + 21 删除，canvas-agent/src 全 28 文件一致）。
> **旧的视觉收口交接已过期，以本文件 + 当前代码为准。** 生图入口已经不在旧位置，照旧文档找会扑空。

## 0. 一句话

代码已收口并推送，**当前没有待改的代码任务**。接手重点不是写代码，而是补自动化做不了的真机 / 人眼验收；唯一的代码后续是按基线继续递减剩余裸值（可选）。

## 1. 当前架构（与旧文档的根本差异）

| 事项 | 现状 |
| --- | --- |
| **生图入口** | 统一在**节点提示词面板** `web/src/components/canvas/canvas-node-prompt-panel.tsx`；模型 / 尺寸 / 数量 / 参考素材 / 生成按钮都在这里，节点类型即生成模式 |
| 「生成配置」节点 | **已删除**（`canvas-config-node-panel.tsx` 不存在），别再去找 |
| 首页 / 提示词库 | **已下线**：`/` 直达画布列表，`/prompts` 页面、导航、提示词来源配置、`prompts_search` 工具全部移除 |
| 端形态 | **桌面单端**：移动端抽屉 / 汉堡菜单 / 所有 <768px 响应式分支已删；溢出检查改为 **1280 / 1440 / 1920** 三档 × 五页 |
| 栈 | React 19 / antd `^6.4.2` / Vite 7.3 / Tailwind v4 / Zustand 5；web 依赖已含 `@tauri-apps/api` |
| 本地 Agent | `canvas-agent/`，opencode 单车道；桌面端由壳读取 `~/.infinite-canvas/canvas-agent.json` 自动连接 |

## 2. 已完成并验证（别重复做）

- **canvas-agent**：`npm test` **76/76 通过**；`npx tsc -p tsconfig.json --noEmit` **0 错误**。接手第一件事若要求补跑，直接跑这两条。
- **web**：`npx tsc --noEmit` 0 错误；`check:tokens` 145/145、`check:boundaries` 正常；`npm run build` 通过。
- 交接前发现并修掉本地 5 个"历史遗留旧文件"（`http.ts` / `skills/store.ts` / `config.ts` / `agent/types.ts` / `skills/store.test.ts`）——旧版还用 `codexBusy` 命名，已全部按远端对齐。**若你看到类似 `codex*` 属性报错，先查本地文件是不是旧版，别改远端代码。**

## 3. 验收命令（当前口径）

```bash
cd canvas-agent && npm test && npx tsc -p tsconfig.json --noEmit
cd web && npx tsc --noEmit && npm run check:tokens && npm run check:boundaries
cd web && npm run build && npm run check:overflow   # 1280/1440/1920，不再是 390/768
cd web && npx vitest run src                        # 上游 bun 测试另跑：bun test tests
```

注意：`vitest run` 全量会因 `bun:test` 收集失败 3 个 suite，是既有问题；门禁是 `vitest run src`。

## 4. 接下来真正要做的（按优先级）

1. **真机 / 人眼验收**（自动化到不了，必须真人）：
   - 在**节点提示词面板**实际走一遍生图（新入口，旧验收结论已失效）
   - 画布节点面板 + Agent 输入框降到 36px 后的手感
   - 桌面三档（1280/1440/1920）实际观感
   - Tauri 桌面端渲染（本轮未构建安装包）
2. **可选代码后续**：剩余 **145 处裸值**按基线只降不增，从同构替换开始（`config-tasks.tsx` 13、`image-generation-pending.tsx` 11 等），跑 `npm run check:tokens` 把关。
3. M2 真机清单剩两条：浏览器「跟随本地代理 / 直连上游」请求路径对照；台账逐条确认不含 Key 原文。

## 5. 纪律（违反即停）

- **不擅自 `commit` / `push`**（用户明确指令除外）、不动 `master`；本地 `/workspace/INTX-dev-new` 无 `.git`，推送需走网关脚本。
- **未经用户明确同意不发任何真实厂商请求**；任何 API Key 不写进任何文件、不用于任何请求。
- **不把「构建全绿」当「真机通过」**；没验的明确写「未验证」。用户说「我验过了」就是验过了。
- `readTaskOutcome()` 三态是唯一判定入口，`confirm` 不得退化成 `allowed`；已收单失败卡不得给「重发」按钮；本地写入失败不得显示成功。
- BeefTV 仅作行为参考、**禁止复制代码**；OpenDirector Apache-2.0 可复制但须署名（`THIRD_PARTY_NOTICES.md`）。
- 不动 `services/api/`、`domain/`、`pages/canvas/` 的业务逻辑；不改依赖版本；不新增超时 / 重试 / 上限等边界值（须先经用户确认）。改 `services/api/image.ts` 必跑 `src/services/api/image.test.ts`。

## 6. 两个已知的坑

- **4 张视觉截图未入库**：`docs/content/docs/progress/visual-consistency-shots/` 在仓库里实际不存在（网关提交接口只收纯文本，PNG 推不上去）；文档未引用这些图，不影响构建。别按 HANDOFF 路径去找。
- **Git 同步隐患**：之前用"存在即跳过"的断点续传留下过旧文件。若要再次同步远端，请用 blob SHA 逐文件比对覆盖，不要只看文件是否存在。
