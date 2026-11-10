# 浏览器端 E2E

一条命令跑完六组验收，`pnpm e2e`。**不需要真实厂商、不联网、不跑真图**——生成一律走内置的演示适配器（Canvas 画 PNG）。

## 前置

- Node >= 20，`pnpm install`
- 系统 Chromium：`helpers.mjs` 会按候选列表自动探测；别的位置用 `CHROMIUM_PATH=/path/to/chrome pnpm e2e` 指定。CI 与本地共用 `bash e2e/resolve-chromium.sh` 做探测（会跑一次 `--version`，过滤掉 Ubuntu 24.04 上存在但起不来的 snap 转接脚本）。
- `playwright-core` 已在 devDependencies，**不会**下载浏览器。

## 用法

```bash
pnpm e2e                          # 自动拉起 dev server，跑完收掉
pnpm dev                          # 也可以自己先开着，脚本会复用 7351
INTX_E2E_URL=http://127.0.0.1:9999/ pnpm e2e   # 指向别处
```

## 六组 spec

| 文件 | 覆盖 |
|---|---|
| `specs/generation.mjs` | 文字→生成出图、分镜逐格 4/4、拼图导出与单格另存（校验 PNG 魔数与尺寸）、刷新后画布与资产库还原 |
| `specs/recovery.mjs` | 撤销/重做、清空可撤销、取消生成走 `canceled`、崩溃恢复提示、`.intx` 导出→清空→导入、包内不含 `apiKey` |
| `specs/stress-200.mjs` | 200 节点独立坐标、拖拽/缩放/平移、整图快照撤销、刷新恢复 200 节点 |
| `specs/material-edit.mjs` | 16:9 裁切输出像素比、黑白蒙版尺寸等于原图、放大 2× 尺寸严格等于原图 ×2 且后端如实标注「演示级 · 非 AI」、三类产物都进资产库且**刷新后不丢** |
| `specs/legacy-import.mjs` | 注入旧 `beasttv-canvas` / `beasttv-projects` 数据 → 只读扫描 → 预览报告 → 确认导入；断言旧 key 仍在、旧产物 URL 没被塞进画布、刷新后恢复 |
| `specs/canvas-basics.mjs` | 空画布起始框与右键添加菜单、节点上 × 与 Delete 删除、Ctrl+D / Ctrl+C+V、拖空白框选多选、悬浮栏左对齐与撤销、自动整理不重叠、抓手切换、演示模式标注 |

每条关键结果都有 `check()` 断言，控制台出现任何 `pageerror` / `console.error` 一律判失败（`finish()`）。截图与导出的 `.intx` 落在 `e2e/output/`，已被 gitignore。

## 五个容易踩的坑

1. **Vite HMR 会给模块 URL 加 `?t=xxx`**。写死 `import('/src/app/stores/graphStore.ts')` 会实例化出另一个 store，注入的节点根本不出现在页面上。`helpers.mjs` 里的 `__intxMod` 从 `performance.getEntriesByType('resource')` 反查页面真正加载的 URL，保证拿到同一个单例。
2. **React Flow 的节点按钮偶尔吃掉合成点击**。`generation.mjs` 用 CDP `Input.dispatchMouseEvent` 派发原始鼠标事件，别改回普通 `.click()`。
3. **默认「区域选择」下左键拖空白是框选，不是平移**。`stress-200.mjs` 测平移前先点 `.mode-switch button` 切到抓手、测完切回；`canvas-basics.mjs` 反过来用这段手势验证框选。改工具模式时这两处要一起看。
4. **点节点别点卡片中心**。文字输入节点中心是 `<textarea>`，`Canvas.tsx` 会正确放行输入框里的原生快捷键（撤销 / 复制粘贴优先），画布的 Ctrl+D / C / V 因此不触发。`canvas-basics.mjs` 点 `.node-head` 选中，并断言焦点已离开输入框——否则测的就不是快捷键本身。
5. **失败也要能退出**。断言抛错时 spec 走不到自己的 `await b.close()`，Playwright 连接会吊住整个 node 进程：曾有一轮 E2E 挂了 16 分钟，日志还因为 `| tail` 全缓冲什么都看不到。现在 `openPage()` 把默认超时压到 15s，`run.mjs` 的 `finally` 调 `closeAllBrowsers()` 兜底关掉所有开过的浏览器；本地跑建议把输出重定向到文件而不是接管道。

## CI

`.github/workflows/ci.yml` 分两个 job：`check` 跑 `pnpm verify` + `pnpm build`，`e2e` 跑 `pnpm e2e`。两者都用 `pnpm install --frozen-lockfile`，pnpm 版本由 `package.json` 的 `packageManager` 字段决定，不在 workflow 里写死。

E2E job 先 `bash e2e/resolve-chromium.sh` 找到一个确实能启动的 Chrome，把路径写进 `CHROMIUM_PATH`，再跑 `pnpm e2e`。dev server 由 `run.mjs` 自己拉起并收掉，CI 不另开常驻服务。失败时把 `e2e/output/` 传成 artifact 保留 7 天，方便查截图与导出样本。

`src/infra/ci/workflow.test.ts` 把 workflow 里的 pnpm 命令、Node 版本、Chromium 候选、产物目录与源码逐项对账——改了 script 名或候选列表却只改一处，会直接红灯而不是等云端失败。

Rust 桌面编译（`tauri:check`）**故意不进 CI**：Linux runner 装 `webkit2gtk-4.1` / `appindicator` 只会拖慢每次提交，与前端验收无关。`Cargo.lock` 已入库（422 个依赖），Windows 侧真正的编译放在独立的 `package-windows.yml`；Linux 侧由 `tauriConfig.test.ts` 做静态配置对账。

## 还没做

- 视频产物、真实厂商、多项目切换的 E2E
