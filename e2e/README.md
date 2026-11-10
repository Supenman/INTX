# 浏览器端 E2E

一条命令跑完三组验收，`pnpm e2e`。**不需要真实厂商、不联网、不跑真图**——生成一律走内置的演示适配器（Canvas 画 PNG）。

## 前置

- Node >= 20，`pnpm install`
- 系统 Chromium：`/usr/bin/chromium` / `google-chrome` 等常见路径会自动探测；别的位置用 `CHROMIUM_PATH=/path/to/chrome pnpm e2e` 指定。
- `playwright-core` 已在 devDependencies，**不会**下载浏览器。

## 用法

```bash
pnpm e2e                          # 自动拉起 dev server，跑完收掉
pnpm dev                          # 也可以自己先开着，脚本会复用 7351
INTX_E2E_URL=http://127.0.0.1:9999/ pnpm e2e   # 指向别处
```

## 三组 spec

| 文件 | 覆盖 |
|---|---|
| `specs/generation.mjs` | 文字→生成出图、分镜逐格 4/4、拼图导出与单格另存（校验 PNG 魔数与尺寸）、刷新后画布与资产库还原 |
| `specs/recovery.mjs` | 撤销/重做、清空可撤销、取消生成走 `canceled`、崩溃恢复提示、`.intx` 导出→清空→导入、包内不含 `apiKey` |
| `specs/stress-200.mjs` | 200 节点独立坐标、拖拽/缩放/平移、整图快照撤销、刷新恢复 200 节点 |

每条关键结果都有 `check()` 断言，控制台出现任何 `pageerror` / `console.error` 一律判失败（`finish()`）。截图与导出的 `.intx` 落在 `e2e/output/`，已被 gitignore。

## 两个容易踩的坑

1. **Vite HMR 会给模块 URL 加 `?t=xxx`**。写死 `import('/src/app/stores/graphStore.ts')` 会实例化出另一个 store，注入的节点根本不出现在页面上。`helpers.mjs` 里的 `__intxMod` 从 `performance.getEntriesByType('resource')` 反查页面真正加载的 URL，保证拿到同一个单例。
2. **React Flow 的节点按钮偶尔吃掉合成点击**。`generation.mjs` 用 CDP `Input.dispatchMouseEvent` 派发原始鼠标事件，别改回普通 `.click()`。

## 还没做

- CI 集成（当前脚本依赖系统 Chromium，容器里能跑，云 CI 需要显式装浏览器）
- 视频产物、真实厂商、多项目切换的 E2E
