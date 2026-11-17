# Infinite Canvas Agent

本地 Canvas Agent 把画布网页和用户电脑上的 **opencode** 连起来。当前只有一条车道：Canvas Agent 自动拉起本机 opencode 服务，默认使用免费模型，不需要 API Key，也不需要用户登录任何厂商账号。本地开发时优先连接 `http://localhost:3000`，不需要先使用线上站点。

## 启动

```bash
npx -y @basketikun/canvas-agent@latest
```

带上 `@latest` 是因为 npx 会缓存已下载的版本，不加就可能一直运行旧版本。

需要排查连接、会话、opencode 服务或工具调用问题时，可开启 Debug 模式：

```bash
npx -y @basketikun/canvas-agent@latest --debug
```

Debug 日志会以 `[DEBUG][HH:mm:ss]` 等传统格式输出到终端，并按启动日期保存到 `~/.infinite-canvas/logs/canvas-agent-YYYY-MM-DD.log`。终端日志带级别颜色，文件日志为纯文本；日志包含 HTTP、SSE、会话、turn、opencode 事件和工具调用，token 与图片 Data URL 会自动隐藏。

本仓库开发时也可以直接运行：

```bash
cd canvas-agent
npm install
npm run build
node dist/index.js
```

启动后会输出本机地址和 token：

```txt
Local URL: http://127.0.0.1:17371
Connect token: xxxxxx
```

在画布右上角点击 `Agent`，填入地址和 token 后连接；网页默认会自动发现这两个值，失败时再手动填写。

Canvas Agent 默认只监听 `127.0.0.1`。网页第一次带正确 token 连接后，Canvas Agent 会记录该网页 Origin；之后其他 Origin 不能复用这个本地 Agent，除非用户清理 `~/.infinite-canvas/canvas-agent.json` 里的 `origins`。

## 发布

`canvas-agent` 使用自己的 `package.json` 版本号，不跟仓库根目录 `VERSION` 绑定。推送到 `main` 后，GitHub Actions 会检查 npm 上是否已经存在当前包版本；不存在时才发布 `@basketikun/canvas-agent`。

发布前需要在 GitHub 仓库 Secrets 中配置 `NPM_TOKEN`。

## MCP 工具

Canvas Agent 通过 `infinite-canvas` MCP 把画布操作暴露给 opencode。opencode 服务由 Canvas Agent 自动拉起并配置该 MCP，网页侧边栏不需要用户手动写 MCP 配置。

只启动本地 Agent 服务、不启动 opencode 时，MCP 命令仍可单独运行：

```bash
npx -y @basketikun/canvas-agent@latest mcp
```

Canvas Agent 源码使用 TypeScript 编写，MCP 协议层使用官方 `@modelcontextprotocol/sdk`，工具入参使用 `zod` 描述。

可用工具：

- `canvas_get_state`
- `canvas_get_selection`
- `canvas_export_snapshot`
- `canvas_apply_ops`
- `canvas_create_text_node`
- `canvas_create_generation_flow`

`canvas_apply_ops` 示例：

```json
{
  "ops": [
    {
      "type": "add_node",
      "nodeType": "text",
      "title": "标题",
      "position": { "x": 0, "y": 0 },
      "metadata": { "content": "文本内容" }
    }
  ]
}
```

## 侧边栏 opencode

本地面板把提示词发送给 Canvas Agent，由它转发给 opencode。事件被归一成 `thread.started`、`turn.started`、`item.started|updated|completed`、`usage.updated`、`turn.completed` 等结构化事件；Canvas Agent 会合并短时间内的回复、思考摘要和工具输出增量，网页使用同一条消息持续更新，并把用量与成本显示在对话下方。

输入框左侧可以选择 opencode 模型，列表来自本地 opencode 服务的 `GET /config/providers`（经 Canvas Agent 的 `/agent/opencode/models` 转发）。选择保存在网页本地，刷新后恢复；模型列表不可用或所选模型已失效时，显示不可用并回退默认免费模型，对话不受影响。

侧边栏支持会话列表（新建 / 恢复 / 删除）、发送消息、停止当前轮、用量显示，以及 `@` 引用画布素材（只带 nodeId 和素材文字，不上传图片）。

> 历史说明：早期版本曾提供 Codex 车道、Codex app 插件与 Claude Code 适配器，并支持在侧边栏切换车道。这些代码与对应的 `/agent/codex/*` 路由已全部移除，`codex mcp add` / `codex plugin add` 等命令不再适用。相关设计记录见 `docs/content/docs/progress/local-agent-integration-plan.mdx`。
