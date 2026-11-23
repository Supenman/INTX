<p align="center">
  <img src="docs/public/workbench-logo.svg" width="72" alt="工作台标志">
</p>

<h1 align="center">工作台</h1>

<p align="center">
  组织创意、生成内容与完成剪辑的一体化空间
</p>

<p align="center">
  <a href="https://github.com/Supenman/INTX"><img src="https://img.shields.io/github/stars/Supenman/INTX?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-f97316?style=flat-square" alt="MIT License"></a>
</p>

<p align="center">
  <a href="docs/content/docs/overview/quick-start.mdx">快速开始</a> ·
  <a href="docs/content/docs/overview/features.mdx">功能介绍</a> ·
  <a href="COMFYUI-LOCAL-SETUP.md">ComfyUI 配置</a> ·
  <a href="docs/content/docs/canvas/canvas-node-manual.mdx">画布节点手册</a> ·
  <a href="docs/content/docs/canvas/canvas-shortcuts.mdx">快捷键</a>
</p>

工作台将可视化画布、AI 模型和短视频剪辑放在同一空间中。你可以把文字、图片和视频组织成节点，调用云端模型或本机 ComfyUI 工作流生成内容，再整理素材并完成剪辑。

## 功能

- **可视化画布**：组织文本、图片、视频和音频节点，使用连线传递提示词与参考素材，并管理多个画布项目。
- **AI 生成**：连接 OpenAI 兼容服务进行图片、音频和视频生成；可导入 ComfyUI API 工作流，声明画布输入并指定结果输出。
- **本地 ComfyUI**：Windows 桌面版内置连接网关，可连接本机 ComfyUI、检查工作流依赖并在画布中调用可用工作流。
- **剪辑台**：将画布素材编排到时间线，添加音频与字幕，预览并导出视频。
- **素材与助手**：保存和管理生成素材；使用画布助手或本地 Canvas Agent 辅助创作。
- **节点插件**：安装画布节点插件，或使用 TypeScript SDK 开发自己的插件。

## 开始使用

### 本地开发

需要 Node.js 22 和 pnpm。克隆项目后运行：

```bash
cd web
pnpm install
pnpm dev
```

浏览器打开 `http://localhost:3000`。启动桌面开发版：

```bash
pnpm tauri:dev
```

构建桌面安装包：

```bash
pnpm tauri:build
```

### 配置 AI 服务

在「配置 → 渠道」中添加服务商提供的 Base URL 和 API Key，然后拉取模型并设置模型能力。API Key、画布和生成记录默认保存在本机浏览器中。

### 使用本地 ComfyUI

先在本机安装并启动 ComfyUI。Windows 桌面版工作台会启动内置网关并连接默认地址 `http://127.0.0.1:8188`。ComfyUI 本体、模型权重和自定义节点需单独安装。

在「配置 → 本地 ComfyUI」导入 ComfyUI 导出的 API 格式工作流，确认输入参数及结果输出后即可在画布模型选择器中使用。依赖未满足的工作流不会作为可用模型提供。

更多说明见 [本地 ComfyUI 配置](COMFYUI-LOCAL-SETUP.md)。

## 项目结构

```text
web/          前端应用与 Tauri 桌面端
comfyui-gateway/ 本地 ComfyUI 网关
canvas-agent/ 本地画布助手
plugins/      官方画布节点插件
docs/         产品与开发文档
```

## 开发检查

```bash
cd web
pnpm verify
```

`pnpm verify` 运行类型检查、代码边界与结构检查及单元测试。

## 许可证

本项目使用 [MIT 许可证](LICENSE)。
