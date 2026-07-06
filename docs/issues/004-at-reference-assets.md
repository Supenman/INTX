---
title: 节点连接与 @ 引用上游资产
type: issue
state: ready-for-agent
category: enhancement
created: 2026-07-03
---

## 目标

节点连接后，在 prompt 中输入 `@` 触发引用菜单，选择上游节点的历史输出，提交生成时自动替换为实际内容。

关联 ADR：0006

## 前端

### 引用触发
- 在 TextNode / ImageNode / VideoNode 的 prompt 输入框中监听 `@` 输入
- 输入 `@` 时弹出下拉菜单，列出所有可达上游节点（通过 React Flow edges 追溯）的历史输出
- 菜单项显示：节点名称 + 输出类型预览（图片缩略图 / 文本摘要）

### 引用格式
- 选择后插入 `@node_id:index` 标记到 prompt 中
- 同一节点可引用多个输出

### 提交时替换
- handleSubmit 时解析 prompt 中的 `@node_id:index`
- 从对应节点的 `images` / `outputs` 等字段获取实际内容
- 如果是文本输出：直接替换为文本
- 如果是图片输出：确定引用方式（传入 URL 还是 base64，取决于上游 API 支持）

### 引用标记渲染
- prompt 输入框中的 `@node_id:index` 用特殊样式高亮显示（tag/chip 样式）
- 支持删除（backspace 或点击 ×）

## 后端

- 无需修改，引用替换在前端完成
- 提交时 prompt 已经是完整内容

## 验收标准

- [ ] 连接线建立后，目标节点的 prompt 中输入 `@` 弹出引用菜单
- [ ] 引用菜单列出上游节点的历史输出
- [ ] 选择后插入 `@` 标记，提交时替换为实际内容
- [ ] 无历史输出的上游节点在菜单中显示为空/不可选
- [ ] lint/build 通过
