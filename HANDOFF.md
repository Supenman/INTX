# HANDOFF — 视觉一致性收口

> 交接对象：另一台电脑上的 agent（workbuddy）
> 起点：`dev` @ `5a334d3`，工作区干净
> 读完这份文件就开始做。**不需要回来问、不需要等确认**，第 6 节写了遇到决策怎么办。

## 0. 一句话

把写死的 `stone / slate / gray / zinc / neutral` 中性色和裸字号收口到项目已有的 design token，让同一个界面在明暗主题下表现一致；交互只动「生成卡片 + 三态提示」的**呈现**，不动流程。

不追求重新设计，追求执行一致。

## 1. 边界（先读；违反即停）

**不可以做：**

- 复制 BeefTV 的任何代码（Source Available，仅设计参考，见 `THIRD_PARTY_NOTICES.md`）
- 改主题色、换视觉语言、改 `canvasThemes` 里的颜色值
- 动 `web/src/services/api/`、`web/src/domain/`、`web/src/pages/canvas/` 下的业务逻辑
- 发任何真实厂商请求；任何 API Key 写进任何文件
- 构建或安装 MSI / NSIS 安装包
- `git push`、动 `master`、改 `package.json` 的依赖版本
- 新增超时 / 重试次数 / 上限等边界值（这类必须先经用户确认）

**已授权：**

- 在 `dev` 上直接 commit（不 push）
- 改样式 class、token、主题配置
- 更新 `CHANGELOG.md` / `pending-test` / `todo`

## 2. 已有的东西（不要重新发明）

- 三层 token（Primitive → Semantic → Component）：`web/src/styles/tokens.css`
- 语义变量：`globals.css` 里的 `--background / --foreground / --card / --popover / --muted / --muted-foreground / --border / --primary / --ring`
- antd 主题：`web/src/lib/app-theme.ts`
- 画布主题：`web/src/lib/canvas-theme.ts`（`canvasThemes`）
- 规矩：`AGENTS.md`，尤其「前端规范」与「画布 UI 规范」两节
- 相邻检查脚本：`web/scripts/check-boundaries.mjs`、`web/scripts/check-overflow.mjs`

## 3. 映射表（照这个换，不要自创）

| 现在的写法 | 换成 |
| --- | --- |
| `bg-white dark:bg-stone-900` | `bg-background` 或 `bg-card` |
| `bg-stone-50 dark:bg-stone-950` | `bg-muted` 或 `surface-card` |
| `border-stone-200 dark:border-stone-800` | `border-border`，浮层边界用 `shadow-[var(--hairline)]` |
| `text-stone-800 dark:text-stone-100` | `text-foreground` |
| `text-stone-500 dark:text-stone-400` | `text-muted-foreground` |
| `bg-stone-900 text-white`（实心按钮） | `bg-[var(--btn-solid-bg)] text-[var(--btn-solid-fg)]` |
| `text-[11px]` / `text-[13px]` | `typ-label` / `typ-caption` / `typ-body-compact` |
| `rounded-[8px]` | `rounded-[var(--r-md)]` |
| `hover:bg-black/5 dark:hover:bg-white/10` | **保留**（AGENTS.md 允许的扁平按钮反馈） |

## 4. 任务清单（按顺序，做完一条勾一条）

### T1 热点四文件（当天可交付）

按第 3 节收口，这四份文件占了全部写死中性色的约四成：

- [ ] `web/src/components/layout/model-script-editor.tsx`（52 处）
- [ ] `web/src/components/canvas/canvas-side-panel.tsx`（39 处）
- [ ] `web/src/components/layout/version-release-modal.tsx`（26 处）
- [ ] `web/src/components/layout/app-config-modal.tsx`（18 处）

**完成定义**：文件内不再出现第 3 节左列的写法（允许保留的扁平 hover 除外）；`npx tsc --noEmit` 退出 0；`npm run build` 通过。

### T2 系统层三条口径

- [ ] **密度**：控件高度只允许 28 / 32 / 36 三档；画布面板用 28 / 32，设置页用 32 / 36
- [ ] **层次**：表面用 surface + hairline 交代，停用「border 和 shadow 混搭」
- [ ] **动效**：150ms ease，无弹跳；antd 弹窗必须「关闭即卸载」（本环境 antd 离场动画会停在 `ant-zoom-leave`）

落点：`tokens.css` + `app-theme.ts`。**不给单个组件加 `dark:` 分支。**

### T3 两个界面对照

- [ ] 画布侧栏 + 设置弹窗，明暗各一张截图，作为交付证据（放 `docs/` 下或直接在报告里说明位置）

### T4 门禁（防回退）

- [ ] 新增 `web/scripts/check-tokens.mjs` 与 `package.json` 的 `check:tokens`
- [ ] 规则同第 3 节；先记录当前剩余数量作为基线，**不允许增加**
- [ ] 挂进 CI（与 `.github/workflows/ui-overflow.yml` 并列）

### T5 文档

- [ ] `CHANGELOG.md` 的 `Unreleased` 加一条 `[优化]`
- [ ] `docs/content/docs/progress/pending-test.mdx` 记录本次可测试变更
- [ ] `docs/content/docs/progress/todo.mdx` 划掉对应项

## 5. 验收命令（每项都跑，记录真实退出码）

```bash
cd web && npx tsc --noEmit
```

```bash
cd web && COREPACK_INTEGRITY_KEYS=0 corepack pnpm@10.28.2 exec vitest run src
```

```bash
cd web && npm run build
```

```bash
cd web && npm run check:overflow
```

```bash
cd web && npm run check:boundaries
```

```bash
cd web && npm run check:tokens
```

已知：`vitest run` 全量会有 3 个 suite 收集失败（`Cannot find package 'bun:test'`，上游 bun 测试），这是既有问题；门禁是 `vitest run src`。

**不在门禁内、也不要做的**：真机验证、安装包、真实厂商请求。这些一律写「未验证」并说明原因。

## 6. 遇到决策怎么办

**不要停下来等确认。** 按下面的默认值走，写进最后的报告：

- 明暗观感拿不准 → 选更接近现有 `surface-card` 的一侧
- 组件语义拿不准 → 看同类已有组件怎么写的
- 想新增 token → 先不加，用最近的现有 token，列进报告
- 判断不了要不要改的组件 → 不动，列进报告
- 某处改动导致构建或测试失败 → 回退那一处，继续往下做，列进报告

## 7. 收尾

1. 第 4 节清单全部勾选
2. 第 5 节验收命令全部通过（未验证项已在报告说明）
3. 提交到 `dev`（**不 push**）
4. 报告包含：做了什么 / 收口前后的数字对比 / 没做的和原因 / 未验证项 / 剩余裸值清单
5. 填完下面的进度表

## 进度

| 项 | 状态 | 备注 |
| --- | --- | --- |
| T1 热点四文件 | 未开始 | |
| T2 系统层三条口径 | 未开始 | |
| T3 两个界面对照 | 未开始 | |
| T4 check:tokens 门禁 | 未开始 | |
| T5 文档 | 未开始 | |
