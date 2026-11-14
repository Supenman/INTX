# INTX 2.2b / 2.2c：红线验收记录

- 验收日期：2026-11-15
- 验收对象：`dev` 分支 HEAD `6c5c1be58a00a9bd387c35e185e09abe3c9efd4a`（2.2c-2）
- 本次验收**不新增功能**，只核对四条红线与证据分级。
- 结论：四条红线全部通过。其中「红线二」只在假上游 + 浏览器自动化下实测；ModelScope 图片异步查单的 UI 实测未覆盖（原因见 §6）。

## 0. 结论速览

| # | 红线 | 结果 | 证据级别 |
|---|------|------|----------|
| 1 | 已收单／可能已计费的任务没有「重发」类入口 | ✅ 通过 | 静态审计 + UI 实测 |
| 2 | 查单只发查询，不产生新的提交 POST | ✅ 通过 | 假上游 + 浏览器自动化实测（视频路径） |
| 3 | 刷新／重启后任务 ID 与证据键仍在 | ✅ 通过 | 真实厂商（任务 ID、资产）+ 故障注入（证据键跨重启） |
| 4 | 补写不产生新 POST，并清除证据键 | ✅ 通过 | 假上游 + 故障注入实测 |

## 1. 验证环境与方法

### 1.1 构建级（本机，2026-11-15 重跑，退出码均为真实值）

| 检查 | 命令 | 退出码 | 结果 |
|------|------|--------|------|
| 类型检查 | `pnpm exec tsc --noEmit` | 0 | 无错误 |
| 单元测试 | `node ./node_modules/vitest/vitest.mjs run src/ --reporter=json` | 0 | 44 个文件 / 661 个用例，0 失败 |
| 依赖边界 | `pnpm run check:boundaries` | 0 | domain 依赖边界正常 |
| 生产构建 | `pnpm run build` | 0 | built in 14.98s |

### 1.2 真机：Tauri 桌面应用（真实厂商）

- 应用：`tauri dev` 启动的 `app.intx.desktop`，版本 0.20.0，WebView2。
- dev 模式下前端来自 `http://localhost:3000`，因此桌面端 IndexedDB 位于
  `%LOCALAPPDATA%/app.intx.desktop/EBWebView/Default/IndexedDB/http_localhost_3000.indexeddb.leveldb/`。
  **打包版会是 `http_tauri.localhost_0`，两者不是同一份数据**，排障时需先确认 origin。
- 由用户本人在桌面端发起一次真实图片生成（ModelScope），验收方只读取本地数据库，不发任何厂商请求。
- 证据读取方式：顺序解析 LevelDB log（32KB block / WriteBatch），区分 live 记录与删除墓碑，避免 raw grep 把已删除历史当成现态。

### 1.3 假上游 + 故障注入（浏览器自动化）

- 假上游：本机 `127.0.0.1:3999`，模拟 OpenAI 兼容视频接口，只返回预设状态；**零真实厂商请求、零计费**。
- 驱动：无头 Chrome + CDP，独立临时 profile，跑同一份 web 代码、真实 UI 组件、真实 IndexedDB。
- 故障注入：仅在隔离 profile 内对 `IDBObjectStore.prototype.put` 打补丁，令键名包含 `intx_task_log` 的写入失败一次，用来制造「产物已保存、任务台账未核销」的真实状态。**没有修改仓库里的任何代码。**

## 2. 红线一：没有重发入口

「配置 → 待核实任务」面板暴露的操作只有：复制任务号、查单、补写素材与任务记录、补写任务记录、重试本地保存。

代码层面 `web/src/components/layout/config-tasks.tsx` 的 `query()` 只解析并写入本地记录，不调用任何提交函数；`readTaskOutcome()`（`web/src/domain/task/outcome.ts`）仍是三态 `allowed | confirm | blocked` 的唯一判定入口。

结论：通过。

## 3. 红线二：查单只发查询

### 3.1 实测过程

假上游收单一条视频任务后刷新页面（模拟崩溃重启），在「待核实任务」面板点「查单」。

### 3.2 浏览器抓包（点击查单期间的全部请求）

```
OPTIONS http://127.0.0.1:3999/v1/videos/vid_mock_2
GET     http://127.0.0.1:3999/v1/videos/vid_mock_2
```

### 3.3 假上游服务端日志（同一轮）

```
16:47:46 POST /v1/videos -> vid_mock_2  (模拟收单)     ← 仅提交时 1 次
16:47:55 GET  /v1/videos/vid_mock_2 -> queued  (查单)
```

整轮只有 1 次 POST（提交），查单期间 0 次 POST。台账在查单前后都保持 `running` + 原 `upstreamRef`。

结论：通过（视频 / OpenAI 兼容查单路径）。

### 3.4 覆盖边界

`pollModelScopeTask` 的异步查单只对 `api-inference.modelscope.cn` 生效（`web/src/domain/provider/endpoints.ts` 的域名门禁），假上游无法覆盖；该路径本轮只做了静态审计（`modelScope.ts` 查单固定 `method: 'GET'`）与单元测试覆盖，未做 UI 实测。

## 4. 红线三：重启保留任务 ID 与证据

### 4.1 真实厂商部分（真机）

真实任务账本终态（重启后从桌面端 IndexedDB 解出，live 记录）：

```json
{
  "id": "tk_mwgklz6001gn2rcg",
  "kind": "image",
  "params": { "model": "…::openmoss/MOSS-Image-SFT", "providerId": "openai", "aspectRatio": "1:1", "count": 1 },
  "status": "succeeded",
  "resultAssetIds": ["HYQnBOFaZZsJyOO8YXUzg"],
  "upstreamRef": "da15e18b-5eed-447a-969e-856ee70eb17a",
  "attempt": 1,
  "error": null
}
```

- 重启后画布上的生成图正常渲染，台账 revision 为 4，记录为 live（无删除墓碑）。
- 该任务的 `intx_task_evidence:` 键已按设计在提交成功后被清除（日志中可见 2 条 `del`），**这是正确行为**：证据键只在「已收单、台账未确认」窗口存在，happy path 看不到它。

### 4.2 证据键跨重启部分（故障注入）

故障注入让台账写入失败一次后：

1. 面板显示「任务记录尚未保存 … 重试本地保存」；
2. IndexedDB 出现证据键：
   ```
   infinite-canvas:intx_recovered_assets:tk_mwgn603d012bjlb3
   infinite-canvas:intx_task_log
   ```
3. 整页刷新（模拟重启）后，证据键**仍在**，面板自动变为「补写任务记录」。

结论：通过。

## 5. 红线四：补写不产生新 POST 且清除证据

在上一步的「补写任务记录」状态下点击该按钮：

| 观测项 | 结果 |
|--------|------|
| 网络请求 | `[]` —— 零请求（不查单、不下载、不提交） |
| 台账终态 | `succeeded`，`upstreamRef` 保留 |
| 证据键 | `intx_recovered_assets:tk_mwgn603d012bjlb3` **已清除** |

结论：通过。

## 6. 未覆盖与边界

1. **ModelScope 图片异步查单的 UI 实测**：域名门禁使假上游无法进入该分支；本轮只有静态审计 + 单元测试。未通过修改 hosts / DNS 绕过。
2. **真实厂商的中断路径**：要在真实厂商上制造「已收单、本地未核销」，需要在出图途中杀进程，会在厂商侧留下一个可能计费的任务。是否执行由用户决定，验收方未擅自操作。
3. **打包版（`http_tauri.localhost` origin）**：本轮真机验证在 `tauri dev` 下完成，安装包形态未测。
4. 故障注入是人为制造写入失败，用于覆盖 UI 无法自然触发的路径；结论应理解为「代码路径正确」，不等同于「真实磁盘故障下已验证」。

## 7. 已知文档偏差

- `docs/INTX-2.2a-存储合同范围与验收.md` §10「阶段状态」仍写着 2.2c-2「已实现、改动尚未提交」；实际已由 `6c5c1be` 提交，该行已过期。
- 交接说明称仓库中不存在 `canvas-agent/`，实际目录树中存在，排查后端问题时不要据此排除。

## 8. 下一步建议

1. 修正 2.2a 文档 §10 的过期状态（纯文档改动）。
2. 若需要补齐 ModelScope 图片查单的真机证据，建议在用户同意计费风险的前提下，用一次真实任务中途杀进程来触发。
3. 在安装包形态下重跑红线三（origin 不同，数据位置不同）。

## 9. 附：本轮涉及的命令与产物

- 类型检查 / 单元测试 / 边界 / 构建：见 §1.1，退出码 0。
- 真机证据：桌面端 `http_localhost_3000.indexeddb.leveldb/000003.log`（只读扫描）。
- 自动化证据：假上游请求日志、CDP 网络抓包（临时目录，未入库）。
- 本轮验收**未修改任何仓库代码，未 commit / push，未触发 master**。
