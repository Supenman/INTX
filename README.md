# BeastTV

一个基于 React Flow 的可视化 AI 内容创作平台，支持文本、图片、视频节点的拖拽、连接、批量生成与历史回放。

## 项目结构

```
BeastTV-React/
├── src/
│   ├── components/
│   │   ├── BaseNode.jsx              # 基础节点组件（图片/视频/文本/素材）
│   │   ├── GroupNode.jsx             # 组合节点容器
│   │   ├── NodeDrawer.jsx            # 节点抽屉面板（与节点一体化）
│   │   ├── SelectionBboxToolbar.jsx  # 框选/单选悬浮工具栏
│   │   ├── OutputHistoryPanel.jsx    # 输出历史面板（替换旧状态日志）
│   │   ├── Sidebar.jsx               # 侧边栏
│   │   ├── ApiSettings.jsx           # API 设置
│   │   ├── AlignmentGuides.jsx       # 对齐/吸附引导线
│   │   └── primitives/
│   │       └── CanvasDropdown.jsx    # 画布原生下拉
│   ├── domain/
│   │   └── nodeTypes.jsx             # 节点类型注册表
│   ├── utils/                        # 通用工具
│   ├── App.jsx                       # 主应用
│   ├── index.css                     # 全局样式（含视觉 token）
│   └── main.jsx
├── backend/
│   ├── main.py                       # FastAPI 后端
│   ├── API/
│   │   └── .env                      # API Key（不提交）
│   ├── data/
│   │   └── api_providers.json        # API 配置
│   └── media/                        # 生成结果缓存
├── package.json
└── README.md
```

## 技术栈

- **前端**: React 19 + Vite 6 + @xyflow/react
- **后端**: FastAPI + Uvicorn + Httpx
- **状态管理**: Zustand

## 快速开始

### 1. 安装依赖

```bash
# 前端
npm install

# 后端
cd backend
python -m venv venv
venv\Scripts\activate
pip install fastapi uvicorn httpx python-dotenv
cd ..
```

### 2. 启动服务

**终端 1 - 启动后端**:
```bash
cd backend
python main.py
```
后端运行在: http://127.0.0.1:8000

**终端 2 - 启动前端**:
```bash
npm run dev
```
前端运行在: http://localhost:5173

或直接双击 `start-beasttv.bat`（统一窗口启动，自动查杀占用端口）。

### 3. 配置 API

1. 打开 http://localhost:5173
2. 点击左侧栏「API 设置」
3. 添加 API Key，配置主平台
4. 开始使用！

## 功能特性

### 节点系统

- ✅ **5 种素材节点**：文本、图片、视频、参考图、参考视频
- ✅ **节点抽屉**：与节点一体化的输入面板（宽度 600px，可调高度）
- ✅ **@-引用**：输入 `@` 唤起 typeahead，引用其他节点作为上下文
- ✅ **宽高比/分辨率预设**：图片/视频节点支持
- ✅ **模型/比例/分辨率联动**：切换自动触发生成
- ✅ **连接数据**：节点间数据传递（文字→文字、图片→文字等）

### 画布交互

- ✅ **拖拽、连接、缩放、平移**
- ✅ **框选 + 多选移动**：拖拽时显示吸附引导线
- ✅ **组合节点**：多选后「打组」，组可整体拖动
- ✅ **排列**：宫格 / 水平 / 垂直三种布局一键应用
- ✅ **悬浮工具栏**：框选或多选时在包围框顶部弹出
- ✅ **键盘快捷键**：Ctrl+Z/Y 撤销重做

### 输出与历史

- ✅ **输出历史面板**：所有生成结果可拖拽回画布复用
- ✅ **生成进度动画**：节点边框渐变呼吸
- ✅ **生成结果直接显示**：图片/视频节点内联展示

### 主题与视觉

- ✅ **深色/浅色主题切换**
- ✅ **暗色暖色调**：降低对比度，长时间使用不刺眼
- ✅ **玻璃质感面板**：backdrop-filter + 半透明背景
- ✅ **视觉 token 系统**：颜色/圆角/阴影/动画缓动统一管理

## 使用说明

### 创建节点

- 点击左侧栏「+」按钮
- 或在画布上右键选择节点类型

### 节点抽屉

点击节点打开抽屉，包含：
- 类型切换
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
| 状态 | `--signal-*` | live/error/idle |
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

### 关键文件

- [src/App.jsx](src/App.jsx) — 主应用、状态、工具栏 bbox 计算
- [src/components/NodeDrawer.jsx](src/components/NodeDrawer.jsx) — 节点抽屉
- [src/components/SelectionBboxToolbar.jsx](src/components/SelectionBboxToolbar.jsx) — 悬浮工具栏
- [src/components/GroupNode.jsx](src/components/GroupNode.jsx) — 组合节点
- [src/index.css](src/index.css) — 视觉 token + 节点/工具栏样式
