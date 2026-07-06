# BeastTV

一个基于 React Flow 的可视化 AI 内容创作平台，支持文本、图片、视频生成。

## 项目结构

```
BeastTV-React/
├── src/
│   ├── components/
│   │   ├── BaseNode.jsx         # 基础节点组件
│   │   ├── ImageNode.jsx        # 图片节点
│   │   ├── TextNode.jsx         # 文本节点
│   │   ├── VideoNode.jsx        # 视频节点
│   │   ├── NodeDrawer.jsx       # 节点抽屉面板
│   │   ├── Sidebar.jsx          # 侧边栏
│   │   ├── ApiSettings.jsx      # API 设置
│   │   └── ...
│   ├── App.jsx
│   └── main.jsx
├── backend/
│   ├── main.py                  # FastAPI 后端
│   ├── API/
│   │   └── .env                 # API Key（不提交）
│   └── data/
│       └── api_providers.json   # API 配置
├── package.json
└── README.md
```

## 技术栈

- **前端**: React 19 + Vite + React Flow (@xyflow/react)
- **后端**: FastAPI + Uvicorn + Httpx

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

### 3. 配置 API

1. 打开 http://localhost:5173
2. 点击左侧栏「API 设置」
3. 添加 API Key，配置主平台
4. 开始使用！

## 功能特性

- ✅ 三种节点类型：文本、图片、视频
- ✅ 节点拖拽和连接
- ✅ 节点抽屉面板（与节点一体化）
- ✅ 宽高比/分辨率预设
- ✅ 模型选择与 API 配置同步
- ✅ 生成进度动画（渐变呼吸效果）
- ✅ 文本节点内容可编辑
- ✅ 多 API 平台支持
- ✅ 深色/浅色主题切换

## 使用说明

### 创建节点

- 点击左侧栏「+」按钮
- 或在画布上右键选择节点类型

### 节点抽屉

点击节点打开抽屉，包含：
- 类型切换
- 模型选择
- 宽高比/分辨率（仅图片/视频）
- 文本输入
- 连接数据选择
- 运行按钮

### 节点连接

拖拽节点右侧连接点，连接到另一个节点的左侧。连接后会自动传递数据。

## 开发说明

### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/providers` | 获取 API 平台配置 |
| PUT | `/api/providers` | 保存 API 平台配置 |
| POST | `/api/providers/test-connection` | 测试连接 |
| POST | `/api/generate` | 生成内容 |
