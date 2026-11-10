# 浏览器端 E2E

一条命令跑完五组验收，`pnpm e2e`。**不需要真实厂商、不联网、不跑真图**——生成一律走内置的演示适配器（Canvas 画 PNG）。

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

## 五组 spec

| 文件 | 覆盖 |
|---|---|
| `specs/generation.mjs` | 文字→生成出图、分镜逐格 4/4、拼图导出与单格另存（校验 PNG 魔数与尺寸）、刷新后画布与资产库还原 |
| `specs/recovery.mjs` | 撤销/重做、清空可撤销、取消生成走 `canceled`、崩溃恢复提示、`.intx` 导出→清空→导入、包内不含 `apiKey` |
| `specs/stress-200.mjs` | 200 节点独立坐标、拖拽/缩放/平移、整图快照撤销、刷新恢复 200 节点 |
| `specs/material-edit.mjs` | 16:9 裁切输出像素比、黑白蒙版尺寸等于原图、放大 2× 尺寸严格等于原图 ×2 且后端如实标注「演示级 · 非 AI」、三类产物都进资产库且**刷新后不丢** |
| `specs/legacy-import.mjs` | 注入旧 `beasttv-canvas` / `beasttv-projects` 数据 → 只读扫描 → 预览报告 → 确认导入；断言旧 key 仍在、旧产物 URL 没被塞进画布、刷新后恢复 |

每条关键结果都有 `check()` 断言，控制台出现任何 `pageerror` / `console.error` 一律判失败（`finish()`）。截图与导出的 `.intx` 落在 `e2e/output/`，已被 gitignore。

## 两个容易踩的坑

1. **Vite HMR 会给模块 URL 加 `?t=xxx`**。写死 `import('/src/app/stores/graphStore.ts')` 会实例化出另一个 store，注入的节点根本不出现在页面上。`helpers.mjs` 里的 `__intxMod` 从 `performance.getEntriesByType('resource')` 反查页面真正加载的 URL，保证拿到同一个单例。
2. **React Flow 的节点按钮偶尔吃掉合成点击**。`generation.mjs` 用 CDP `Input.dispatchMouseEvent` 派发原始鼠标事件，别改回普通 `.click()`。

## CI

`.github/workflows/ci.yml` 分两个 job：`check` 跑 `pnpm verify` + `pnpm build`，`e2e` 跑 `pnpm e2e`。两者都用 `pnpm install --frozen-lockfile`，pnpm 版本由 `package.json` 的 `packageManager` 字段决定，不在 workflow 里写死。

E2E job 先 `bash e2e/resolve-chromium.sh` 找到一个确实能启动的 Chrome，把路径写进 `CHROMIUM_PATH`，再跑 `pnpm e2e`。dev server 由 `run.mjs` 自己拉起并收掉，CI 不另开常驻服务。失败时把 `e2e/output/` 传成 artifact 保留 7 天，方便查截图与导出样本。

`src/infra/ci/workflow.test.ts` 把 workflow 里的 pnpm 命令、Node 版本、Chromium 候选、产物目录与源码逐项对账——改了 script 名或候选列表却只改一处，会直接红灯而不是等云端失败。

Rust 桌面编译（`tauri:check`）**故意不进 CI**：runner 缺 `webkit2gtk-4.1` / `appindicator`，`Cargo.lock` 也还没生成。桌面侧目前由 `tauriConfig.test.ts` 做静态配置对账，真机构建留给装好系统依赖的开发机。

## 还没做

- 视频产物、真实厂商、多项目切换的 E2E
