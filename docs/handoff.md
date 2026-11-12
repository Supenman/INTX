# 开发交接说明（换机继续）

> 写于阶段二第一批代码完成、待最终回归之时。另一台电脑按本文即可接续。

## 当前状态

- **阶段一（UI 与交互基础）已完成**：参数控件、面板统一、画布交互（右键三态/拖入/快捷键/视图）、反馈层级。旧 17 组 e2e 全绿。
- **阶段二第一批（分镜修复+结果闭环）代码已完成**：
  - 缩格 resume 三分支（截断/漂移拒绝/补格），修复 10 条产物混合真 bug
  - 逐格重发（cellIndex）、取消后「继续补齐」
  - generate 多张（count 1-4）+ 缩略图选主图 + 另存
  - 拆分确认（行数≠格数、已有产物）、快照补 count/style、导出 containRect 防变形
- **已通过**：typecheck / lint / 509 项单测 / 结构预算 / 旧 17 组 e2e。
- **待办（唯一）**：新 4 组 e2e 首轮 18/21，3 个失败均为测试等待写短（mock 每格约 2s），已改为轮询等终态，**尚未重跑确认**。

## 换机后第一步

```bash
# 1. 环境（Node >= 20，pnpm 由 corepack 提供，与 packageManager 声明一致）
corepack pnpm install --frozen-lockfile

# 2. 静态检查 + 单测
corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test && corepack pnpm budget

# 3. 全量 e2e（21 组）。Windows 需指定本机 Chrome；Linux/macOS 自动探测
CHROMIUM_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" corepack pnpm e2e
```

预期 21/21。若新 4 组仍有个别失败，先看是否时序（用 spec 内 waitTerminal 模式），产品逻辑已有 509 项单测压阵。

## 关键文档

- `docs/intx-mature-project-plan.md` — 整体路线（阶段一~六）
- `docs/reference-roadmap.md` — BeefTV 复用决策与基线记录
- `THIRD_PARTY_NOTICES.md` — 参考来源与许可边界
- 计划文件（本机 Claude 会话目录，不在仓库）：阶段二第一批详细方案已执行完毕

## 下一步方向（回归通过后）

1. **真实渠道接入**：用户已确认用 ModelScope（`https://api-inference.modelscope.cn`，OpenAI 兼容 `/v1/images/generations`，异步模式 `X-ModelScope-Async-Mode: true` → task_id → 轮询 `/v1/tasks/{id}`）。需要用户的 API Key 与费用授权。涉及 upstreamRef 捕获与提交不确定语义。
2. 模型配置增强：节点级模型选择器、test() 错误分类（401/404/参数错）、能力不匹配事前拦截。
3. 之后按整体计划进阶段三（多项目与数据可靠性）。

## 约定与红线

- 结构预算：单文件 ≤800 行硬上限；canvas.css 已 799 行，**新样式放 results.css/tools.css**；总行数超基线 15% 需显式 `budget:update` 并写明理由。
- e2e 用 `window.__intxMod` 直读 store；confirm 用桩记录文案（避免与 helpers 的 dialog listener 冲突）。
- 不引入组件库；domain 纯函数可单测；UI 经 store action。
- BeefTV 只读参考，不整包搬入；个人本地使用，许可边界见 THIRD_PARTY_NOTICES。
