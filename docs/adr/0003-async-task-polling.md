# ADR 0003 — 异步任务 + 轮询架构

## 状态

已接受 — 2026-07-03

## 背景

之前 `/api/generate` 是同步接口，前端发起请求后需要一直等待上游 AI 服务返回结果。生图通常需要 10-30 秒，视频更久，同步等待让前端只能显示简单转圈，用户体验差，且长连接容易超时。

参考 Infinite-Canvas 的方案，改为异步任务模式。

## 决策

- 新增 `POST /api/tasks` 创建生成任务，立即返回 `{task_id, status: "queued"}`
- 后端用 `asyncio.create_task()` 在后台异步处理生成
- 新增 `GET /api/tasks/{task_id}` 查询任务状态
- 状态流转：`queued` → `running` → `succeeded`（含结果）| `failed`（含错误信息）
- 前端每 2 秒轮询一次任务状态（最多 900 次 ≈ 30 分钟超时）
- image / text / video 三种类型统一走这个异步链路
- 任务数据存储在内存 `CANVAS_TASKS` dict 中（服务重启后丢失）

## 影响

- 前端 NodeDrawer 的 handleSubmit 改为：创建任务 → 轮询 → 结果填入节点
- 节点数据结构需要扩展 `pendingTasks`、`pending`、`running` 等字段
- 后端需要管理多个并发任务的生命周期
- 服务重启后正在进行的任务会丢失（可接受的 MVP 限制）
