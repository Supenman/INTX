---
title: TextNode 文本生成流程
type: issue
state: ready-for-agent
category: enhancement
created: 2026-07-03
---

## 目标

TextNode 实现文本生成：用户在节点中输入 prompt，点击运行，调用上游 chat/completions API，结果展示在节点卡片中。

基于 001 异步任务基础设施。

## 后端

- `run_canvas_text_task`：调用 `/v1/chat/completions`，返回的文本存到 `backend/media/texts/{task_id}.txt`
- 任务结果包含 `{type: "text", content: "生成文本"}` 或 `{type: "text", url: "/api/media/texts/{task_id}.txt"}`

## 前端

- TextNode 抽屉保持现有 prompt 输入框
- 点击运行：`POST /api/tasks {type:"text", ...}` → 轮询 → 卡片展示生成的文本
- 文本展示：卡片内容区显示生成的文字，过长可滚动
- pending 状态：显示"生成中..." + 动画
- provider_id 传递方式同 ImageNode

## 验收标准

- [ ] TextNode 能调通 chat/completions 并返回文本
- [ ] 前端点击运行 → 等待 → 卡片显示生成的文本
- [ ] lint/build 通过
