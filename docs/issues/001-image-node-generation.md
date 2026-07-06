---
title: ImageNode 端到端生成流程（异步任务 + 本地存图）
type: issue
state: ready-for-agent
category: enhancement
created: 2026-07-03
---

## 目标

ImageNode 实现完整的"点击运行 → 后端异步生成 → 节点显示图片"闭环。同时建立后端异步任务基础设施和本地媒体存储方案。

关联 ADR：0003、0004、0005

## 后端任务

### 异步任务系统
- 新增 `POST /api/tasks`：创建生成任务，立即返回 `{task_id, status: "queued"}`
- 新增 `GET /api/tasks/{task_id}`：查询任务状态
- 状态流转 `queued → running → succeeded/failed`
- 内存存储 `CANVAS_TASKS` + 线程锁
- `asyncio.create_task` 后台执行

### GeneratePayload
```python
class GeneratePayload(BaseModel):
    type: str = "image"
    prompt: str = ""
    model: str = ""
    provider_id: str = ""    # 新增，用来查对应平台的 base_url 和 api_key
    aspect_ratio: Optional[str] = None
    resolution: Optional[str] = None
```

### 图片生成执行
- 调用上游 `/v1/images/generations`（复用现有 `call_openai_compatible_api`）
- 下载返回的图片到 `backend/media/images/{task_id}.png`
- 任务结果返回本地 URL：`/api/media/images/{task_id}.png`

### 静态文件服务
- 后端挂载 `/api/media` → `backend/media/` 目录

## 前端

### 节点运行
- NodeDrawer 的 handleSubmit：调用 `POST /api/tasks` → 每 2s 轮询 `GET /api/tasks/{task_id}` → 结果填入节点

### 节点卡片状态
- 运行中：节点卡片显示 pending 状态（缩小占位框 + 旋转动画或文字）
- 完成后：图片替换卡片内容区域（原有模型选择/prompt 可保留在抽屉里）
- 失败时：卡片显示错误提示

### provider_id 传递
- 节点当前选中的模型 → 查 `api_providers.json` 找到该模型所属的平台 ID → 传到 `/api/tasks`

## 验收标准

- [ ] `curl -X POST /api/tasks -d '{"type":"image","model":"...","provider_id":"modelscope","prompt":"test"}'` 返回 `task_id`
- [ ] `GET /api/tasks/{task_id}` 轮询最终返回 `status: "succeeded"` + `result` 含本地 URL
- [ ] 本地图片文件生成在 `backend/media/images/` 下
- [ ] 浏览器访问 `/api/media/images/{task_id}.png` 可查看图片
- [ ] 前端 ImageNode 点击运行 → 显示 pending 状态 → 图片替换卡片
- [ ] 重新生成覆盖旧图
- [ ] lint/build 通过
