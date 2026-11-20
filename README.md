<p align="center">
  <img src="web/public/logo.svg" width="96" alt="无限画布 logo">
</p>

<h1 align="center">无限画布 (INTX)</h1>

<p align="center">
  <a href="https://github.com/Supenman/INTX"><img src="https://img.shields.io/github/stars/Supenman/INTX?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="https://github.com/Supenman/INTX/commits/dev"><img src="https://img.shields.io/github/last-commit/Supenman/INTX/dev?style=flat-square" alt="Last commit"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-f97316?style=flat-square" alt="License"></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-7-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react&logoColor=white" alt="React"></a>
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Tauri-2-24c8db?style=flat-square&logo=tauri&logoColor=white" alt="Tauri"></a>
</p>

<p align="center">
  <a href="docs/content/docs/overview/quick-start.mdx">快速开始</a> · <a href="docs/content/docs/overview/features.mdx">功能介绍</a> · <a href="docs/content/docs/canvas/canvas-node-manual.mdx">画布节点手册</a> · <a href="docs/content/docs/canvas/canvas-shortcuts.mdx">画布快捷键</a> · <a href="docs/content/docs/progress/todo.mdx">待办事项</a> · <a href="canvas-agent/README.md">本地 Canvas Agent</a>
</p>

无限画布（INTX）是一款面向图片与短视频创作的开源工作台。它把画布编排、AI 图片生成、参考图编辑、对话助手、项目级时间线剪辑和素材沉淀放在同一个界面里，适合用来探索视觉方案、连续迭代图片结果，并直接剪成可导出的短视频。

> [!CAUTION]
> 项目目前处于开发阶段，不保证历史数据兼容。各种本地存储格式都可能直接调整，欢迎关注后续更新。
>
> 如果你需要稳定维护自己的分支，建议自行 fork 后独立开发。

## 核心功能

- **无限画布**：多画布项目、节点拖拽缩放、连线、小地图、撤销重做、多选对齐与等距分布、分组、框选、复制粘贴、导入导出。
- **AI 创作**：浏览器前台直连你配置的 OpenAI 兼容接口，支持文生图、图生图、参考图编辑、文本问答、音频和视频生成；生成前显示费用预估，任务中心记录成本、耗时与错误诊断。
- **时间线剪辑**：把图片 / 视频镜头排成项目时间线，支持拖动排序、播放头定位、在播放头处切分、拖拽裁切入出点与帧网格 / 相邻片段边缘吸附；音频轨按时间线混音，文字轨字幕在**预览与导出中同源烧进画面**，导出按环境自动选 MP4（H.264）或 WebM（VP9）。
- **画布助手**：围绕选中节点和上游节点对话、生图，并把结果插回画布。
- **本地 Agent**：通过本机 Canvas Agent 自动拉起 opencode，用免费模型通过 MCP 操作当前画布，无需 API Key；支持在输入框选择模型、搜索与重命名历史会话。
- **插件系统**：支持通过 URL 动态安装 / 启用 / 更新 / 卸载远程节点插件，并提供 TypeScript SDK 自行开发画布节点插件。
- **自定义接口调用**：可自定义生图 / 视频接口的调用方式，灵活适配各类中转站与自建服务。

完整功能说明见 [功能介绍](docs/content/docs/overview/features.mdx)。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vite 7、React 18、TypeScript、React Router、Tailwind v4、Ant Design、Zustand |
| 桌面壳 | Tauri 2（Rust），release 内嵌前端产物可离线启动 |
| 本地 Agent | Node.js + TypeScript（`canvas-agent/`），桥接 opencode |
| 导出 | WebCodecs + mediabunny，MP4 / WebM 双容器按能力自动降级 |

## 快速开始

AI API Key、Base URL、画布、素材和生成记录默认保存在浏览器本地。

### 本地开发

```bash
git clone https://github.com/Supenman/INTX.git
cd INTX/web
bun install
bun run dev
```

### 质量门禁

```bash
cd web
pnpm verify   # typecheck + 依赖边界 + 设计令牌 + 结构预算 + 单测
```

`verify` 聚合了四条静态门禁（依赖边界、设计令牌基线、超长文件预算）与全部单测，CI 在推送到 `dev` 时自动跑同一套。

### 桌面端

```bash
cd web
pnpm tauri:dev     # 开发
pnpm tauri:build   # 打包
```

运行后默认端口 3000，可访问 `http://localhost:3000`。

首次打开后进入右上角配置，填入自己的 OpenAI 兼容 `Base URL` 和 `API Key`。如果默认的 OpenAI 接口调用方式与你的 API 不同，可自定义生图 / 视频脚本调用。

## 目录结构

```
web/          前端应用（Vite + React + Tauri 桌面壳）
canvas-agent/ 本地 Agent（opencode 桥接）
plugins/      画布节点插件
docs/         文档站内容（Astro / MDX）
```

## 开发约定

- 新增逻辑优先独立成文件，不往超大文件里堆；结构预算门禁只许降不许升。
- 改动 `web/src/services/api/image.ts` 必须跑对应单测。
- 厂商请求统一出口，`domain` 层不碰 IO。

## 开源协议

本项目使用 [MIT License](LICENSE)。任何人都可以免费使用、复制、修改、分发、再授权和商业使用本项目，也可以用于闭源产品。
