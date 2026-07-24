# BeastTV

一个基于 React Flow 的可视化 AI 内容创作平台，支持文本、图片、视频节点的拖拽、连接、批量生成与历史回放。

## 项目结构

```
BeastTV-React/
├── src/
│   ├── components/
│   │   ├── BaseNode.jsx               # 基础节点组件（图片/视频/文本/素材）
│   │   ├── GroupNode.jsx              # 组合节点容器
│   │   ├── NodeDrawer.jsx             # 节点抽屉面板（与节点一体化）
│   │   ├── NodeToolbar.jsx            # 节点浮动工具栏（复制/删除/全屏/裁切/超分）
│   │   ├── NodeContextMenu.jsx         # 右键菜单
│   │   ├── SelectionBboxToolbar.jsx   # 多选/组悬浮工具栏
│   │   ├── PageToolbar.jsx            # 页面工具栏（项目/撤销/重做/历史）
│   │   ├── OutputHistoryPanel.jsx     # 输出历史面板
│   │   ├── Sidebar.jsx                # 侧边栏
│   │   ├── SettingsPanel.jsx          # 设置面板
│   │   ├── ApiSettings.jsx            # API 设置
│   │   ├── AlignmentGuides.jsx        # 对齐/吸附引导线
│   │   ├── FullscreenOverlay.jsx      # 全屏预览覆盖层
│   │   ├── ZoomableImage.jsx          # 可缩放图片查看器
│   │   ├── CropEditor.jsx             # 裁切编辑器
│   │   ├── ProjectSelector.jsx        # 项目选择器
│   │   └── primitives/
│   │       └── CanvasDropdown.jsx     # 画布原生下拉
│   ├── domain/
│   │   └── nodeTypes.jsx              # 节点类型注册表
│   ├── utils/                         # 通用工具
│   ├── App.jsx                        # 主应用
│   ├── index.css                      # 全局样式（含视觉 token）
│   └── main.jsx
├── src-tauri/                         # Tauri 桌面壳 + ONNX Runtime
│   └── src/
│       ├── main.rs
│       ├── lib.rs                     # 注册 Tauri 命令
│       └── models.rs                  # 高清超分 & 主体抠图推理
├── backend/
│   ├── main.py                        # FastAPI 后端
│   ├── API/
│   │   └── .env                       # API Key（不提交）
│   ├── data/
│   │   └── api_providers.json         # API 配置
│   └── media/                         # 生成结果缓存
├── package.json
├── tauri-dev.bat                      # Tauri 桌面开发启动脚本
└── README.md
```

## 技术栈

- **桌面端**: Tauri 2 + Rust + ONNX Runtime
- **前端**: React 19 + Vite 6 + @xyflow/react
- **后端**: FastAPI + Uvicorn + Httpx

## 快速开始

### 1. 安装依赖

```bash
npm install

# 后端
cd backend
python -m venv venv
venv\Scripts\activate
pip install fastapi uvicorn httpx python-dotenv
cd ..
```

### 2. 启动开发服务

**Web 版（纯前端调试）**:
```bash
npm run dev
```
前端运行在: http://localhost:5173

**桌面版（需 VS 2022 + MSVC 14.44）**:
```bash
# 方式 1：双击脚本
tauri-dev.bat

# 方式 2：VS Developer Command Prompt 内
npx tauri dev
```

**后端**:
```bash
cd backend
python main.py
```
后端运行在: http://127.0.0.1:8000

### 3. 配置 API

1. 打开应用
2. 点击侧边栏「设置」
3. 添加 API Key，配置主平台
4. 开始使用！

## 功能特性

### 节点系统

- ✅ **5 种素材节点**：文本、图片、视频、音频、Markdown
- ✅ **3 种创作节点**：图片、文字、视频（AI 生成）
- ✅ **节点抽屉**：与节点一体化的输入面板（宽度 600px）
- ✅ **@-引用**：输入 `@` 唤起 typeahead，引用其他节点作为上下文
- ✅ **宽高比/分辨率预设**：图片/视频节点支持
- ✅ **模型/比例/分辨率联动**：切换自动触发生成
- ✅ **连接数据**：节点间数据传递

### 节点浮动工具栏

选中单个节点时，在节点上方显示浮动工具栏，按节点类型提供不同操作：

| 按钮 | 图片 | 文字 | 视频 | 图片素材 |
|------|------|------|------|---------|
| 复制节点 | ✅ | ✅ | ✅ | ✅ |
| 删除节点 | ✅ | ✅ | ✅ | ✅ |
| 全屏预览 | | | | ✅ |
| 替换图片 | | | | ✅ |
| 裁切编辑器 | | | | ✅ |
| 下载 | | | | ✅ |
| 高清超分 | | | | ✅ |
| 主体抠图 | | | | ✅ |

### 裁切编辑器（CropEditor）

- 在图片上拖拽选择裁切区域
- 8 方向手柄调整选区
- 6 种宽高比预设：自由、1:1、4:3、16:9、3:4、9:16
- 确认后 canvas 渲染，自动创建新素材节点

### 全屏预览（FullscreenOverlay + ZoomableImage）

- 滚轮缩放（1x–8x）
- 拖拽平移（放大后）
- 底部缩放控制条（+ / 百分比 / −）

### 画布交互

- ✅ **拖拽、连接、缩放、平移**（中键平移，左键框选）
- ✅ **框选 + 多选移动**：拖拽时显示吸附引导线
- ✅ **组合节点**：多选后「打组」，组可整体拖动，支持背景色预设
- ✅ **排列**：宫格 / 水平 / 垂直三种布局一键应用
- ✅ **键盘快捷键**：Ctrl+Z/Y 撤销重做
- ✅ **统一光标**：节点卡片 pointer、handle crosshair、框选/连线中 body crosshair

### 输出与历史

- ✅ **输出历史面板**：所有生成结果可拖拽回画布复用
- ✅ **生成进度动画**：节点边框渐变呼吸
- ✅ **生成结果直接显示**：图片/视频节点内联展示

### 主题与视觉

- ✅ **深色/浅色主题切换**
- ✅ **黑/白/灰 3 色 + 12 级灰度**，无 signal 色系，仅用边框样式区分
- ✅ **玻璃质感面板**：backdrop-filter + 半透明背景
- ✅ **视觉 token 系统**：颜色/圆角/阴影/动画缓动统一管理

### 桌面端 AI 推理（Tauri + ONNX Runtime）

- ✅ **高清超分**：Real-ESRGAN x4 模型，本地推理（~8MB 模型）
- ✅ **主体抠图**：RMBG-1.4 模型，自动去背景（~12MB 模型）
- ✅ **自动下载**：首次使用时从 HuggingFace 拉取模型，缓存到本地
- ✅ **不依赖云端**：纯本地推理，不上传图片

## 使用说明

### 创建节点

- 点击侧边栏「+」按钮
- 或在画布上右键选择节点类型
- 或从输出历史拖拽到画布

### 节点抽屉

点击创作节点打开抽屉，包含：
- 类型切换（图片↔文字↔视频）
- 模型选择
- 宽高比/分辨率（仅图片/视频）
- 文本输入（支持 `@` 引用其他节点）
- 连接数据 dock
- 「↑ 生成」提交按钮

快捷键：
- `Enter` — 发送
- `Shift+Enter` — 换行
- `Backspace` 在 chip 边界 — 删除引用

### 节点连接

拖拽节点右侧连接点，连接到另一个节点的左侧。连接后会自动传递数据。

### 浮动工具栏

选中素材节点后，工具栏出现在节点上方，提供全屏预览、替换、裁切、下载、高清超分、主体抠图等操作。

### 框选 / 打组 / 排列

1. 在画布空白处按下并拖拽，框选多个节点
2. 悬浮工具栏出现在包围框顶部
3. 点击「排列」选择布局（宫格/水平/垂直）
4. 点击「打组」将选区合并为一个组
5. 点击「解组」恢复

## 开发说明

### 视觉 token（src/index.css :root）

| 类别 | 变量 | 用途 |
|------|------|------|
| 颜色 | `--bg-*`, `--panel-*` | 背景与面板 |
| 文本 | `--text-primary/secondary/tertiary` | 文字层级 |
| 强调 | `--accent`, `--accent-soft` | 主色与柔化 |
| 圆角 | `--radius-*` | 统一圆角 |
| 阴影 | `--panel-shadow` | 玻璃面板投影 |
| 动效 | `--ease-out` | 缓动曲线 |

### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/providers` | 获取 API 平台配置 |
| PUT | `/api/providers` | 保存 API 平台配置 |
| POST | `/api/providers/test-connection` | 测试连接 |
| POST | `/api/generate` | 生成内容 |

### Tauri 桌面端

- Rust 后端通过 `#[tauri::command]` 暴露 `upscale_image` 和 `matting_image`
- 前端通过 `@tauri-apps/api/core` 的 `invoke()` 调用
- 模型从 HuggingFace 自动下载到 `app_data_dir/models/`
- 需 VS 2022 + MSVC 14.44 编译（见 `tauri-dev.bat`）

### 关键文件

- [src/App.jsx](src/App.jsx) — 主应用、状态、工具栏 bbox 计算
- [src/components/BaseNode.jsx](src/components/BaseNode.jsx) — 节点统一外壳
- [src/components/NodeDrawer.jsx](src/components/NodeDrawer.jsx) — 节点抽屉
- [src/components/NodeToolbar.jsx](src/components/NodeToolbar.jsx) — 节点浮动工具栏
- [src/components/CropEditor.jsx](src/components/CropEditor.jsx) — 裁切编辑器
- [src/components/FullscreenOverlay.jsx](src/components/FullscreenOverlay.jsx) — 全屏预览
- [src/components/ZoomableImage.jsx](src/components/ZoomableImage.jsx) — 缩放图片查看器
- [src/components/SelectionBboxToolbar.jsx](src/components/SelectionBboxToolbar.jsx) — 多选工具栏
- [src/components/GroupNode.jsx](src/components/GroupNode.jsx) — 组合节点
- [src/index.css](src/index.css) — 视觉 token + 所有组件样式
- [src-tauri/src/models.rs](src-tauri/src/models.rs) — ONNX 超分/抠图推理
- [tauri-dev.bat](tauri-dev.bat) — 桌面版启动脚本
