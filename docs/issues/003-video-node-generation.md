---
title: VideoNode 视频生成流程
type: issue
state: ready-for-agent
category: enhancement
created: 2026-07-03
---

## 目标

VideoNode 实现视频生成。基于 001 异步任务基础设施，调用上游视频生成 API，结果展示在节点卡片中（视频播放器）。

## 后端

- `run_canvas_video_task`：调用上游视频生成 API（不同平台协议差异较大，需处理异步查询逻辑）
- 视频结果存到 `backend/media/videos/{task_id}.mp4`

### 平台支持策略

- 优先支持 ModelScope / 通用 OpenAI 兼容视频接口
- 视频任务可能需要额外的异步轮询（上游本身返回 task_id 后再查结果），需要嵌套轮询逻辑
- 超时时间可适当延长（视频生成通常 1-5 分钟）

## 前端

- VideoNode 抽屉：prompt + 视频特有参数（duration、fps 等）
- 运行：`POST /api/tasks {type:"video", ...}` → 轮询 → 卡片显示 `<video>` 播放器
- pending 状态：显示"视频生成中..." + 预计时间提示
- 其他状态显示同 ImageNode

## 验收标准

- [ ] VideoNode 运行后能在至少一个平台上生成视频
- [ ] 卡片内可播放生成的视频
- [ ] lint/build 通过
