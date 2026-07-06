# ADR 0002 — 升级到 ESLint 9 flat config

## 状态

已接受 — 2026-06-29

## 背景

项目 `package.json` 已经依赖 ESLint 9，但仓库缺少 `eslint.config.js`，导致 `npm run lint` 直接报错：`ESLint couldn't find an eslint.config.(js|mjs|cjs) file.`

## 决策

- 引入 ESLint 9 的 flat config：`eslint.config.js`。
- 启用：JS 推荐规则、React Hooks、React Refresh 友好检查。
- 暂不引入完整的 `eslint-plugin-react`，仅在 `no-unused-vars` 中允许大写开头的变量名（用于避开 JSX 组件误报）。

## 后果

- 优点：`npm run lint` 立即可用；后续继续小步收紧规则。
- 缺点：当前没有针对 React 18+/JSX 的死代码检测，依赖 `varsIgnorePattern: '^([A-Z]|_)'` 这条临时规则。
- 后续：未来可考虑按需加 `eslint-plugin-react` 并移除 `varsIgnorePattern`。
