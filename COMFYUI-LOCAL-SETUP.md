# 让 INTX 用上本地 ComfyUI（自用版）

> 目标：让 INTX 连上本机的 ComfyUI 出图。
> 前提：Windows + NVIDIA 显卡，已能跑 ComfyUI；本机有 Node.js 且在 PATH 中。
> 做法：INTX 桌面端**自动拉起并回收**参考项目的 `comfyui-gateway`，你只管开 ComfyUI；INTX 当 OpenAI 兼容渠道连过去。
> 这不是「把 ComfyUI 塞进 INTX」，而是「INTX 连一个本地服务」。
>
> 启动方式：**打开 INTX 网关自动起，关闭 INTX 网关自动关**，不用碰任何脚本。若 8190 已被你自己起的网关占用，INTX 直接接管，不会重复启动、退出时也不会关掉它。

## 协议兼容性核对结论（已逐字段读源码确认）

对照网关 `server.js` 与 INTX 的 `image.ts` / `video.ts`，三条链路全部匹配，**理论上零代码改动**：

| 接口 | 网关返回 | INTX 期望 | 结论 |
|---|---|---|---|
| `/v1/models` | `{ data: [{ id, object:"model" }] }` | 读 `payload.data[].id` | ✅ 匹配 |
| `POST /v1/images/generations` | `{ created, data: [{ b64_json }] }` | `parseImagePayload` 读 `data[].b64_json`，且请求已带 `response_format:"b64_json"` | ✅ 匹配 |
| `POST /v1/videos` | `{ id, status:"queued" }` | 读 `created.id`，provider 记 `openai` | ✅ 匹配 |
| `GET /v1/videos/:id` | `status: queued/running/completed/failed/cancelled`，`url` 字段 | `pollOpenAIVideoTask` 读同名 status + `url` | ✅ 匹配 |
| `GET /v1/videos/:id/content` | 返回视频字节流 | `transport.blob()` 取 blob | ✅ 匹配 |

> 说明：沙箱为 Linux、无 GPU 与依赖，未能实际启动网关做端到端 mock；上表是直接读双方协议实现得出的结论。真实出图仍需在你的 Windows 机器上验证。

配套脚本：`comfyui-local-kit/启动本地ComfyUI网关.ps1` 是**手动备用方案**（比如调试网关、或不用桌面端时）。正常用 INTX 不需要它——INTX 会自动拉起网关。

---

## 第 0 步：确认前置

- [ ] Windows 10/11，NVIDIA 显卡驱动正常
- [ ] ComfyUI 便携版能正常启动、能出图
- [ ] Node.js 24+（`node -v` 确认）

---

## 第 1 步：启动 ComfyUI

双击 ComfyUI 便携版的 `run_nvidia_gpu.bat`，等它加载完，浏览器打开：

```
http://127.0.0.1:8188
```

能看到 ComfyUI 界面即可。**保持它开着**，网关要连它。

---

## 第 2 步：把网关放到 INTX 旁边

只拉网关目录，不拉它整个仓库（仓库带 LFS 大文件，完整 clone 很慢）：

```bat
git clone --depth 1 --filter=blob:none --sparse https://github.com/1314521gjy/ComfyUI-Local-Infinite-Canvas.git
cd ComfyUI-Local-Infinite-Canvas
git sparse-checkout set comfyui-gateway
```

> 没装 Git 的话，直接在 GitHub 页面「Code → Download ZIP」，解压后只用 `comfyui-gateway` 目录。

把 `comfyui-gateway` 整个目录放到 **INTX 安装目录旁边**（和 `INTX.exe` 同级）。INTX 启动时会自动在这里找到它。放别处也行，那就设一个环境变量 `INTX_COMFY_GATEWAY_DIR` 指向该目录。

---

## 第 3 步：装一次依赖（只需一次）

```bat
cd comfyui-gateway
npm install
```

`node_modules` 装好后就不用再管了。之后每次开 INTX，它会自动用系统 `node` 拉起网关（端口 8190、连 8188 的 ComfyUI），关 INTX 时自动回收。

> 前提：系统 `node` 在 PATH 里（`node -v` 能跑通即可）。INTX 用的是**系统 node**，不是自带的那个，因为网关依赖是按系统 node 版本装的。

---

## 第 4 步：自检网关

先启动 INTX，等几秒让网关就绪，然后新开一个 PowerShell：

```powershell
curl http://127.0.0.1:8190/health
curl http://127.0.0.1:8190/v1/models
```

- `/health` 应返回 ok。
- `/v1/models` 应列出 `image-...` / `video-...` 之类的模型。
- **如果 8190 连不上**：确认网关目录位置对不对（安装目录旁或 `INTX_COMFY_GATEWAY_DIR`）、`node_modules` 装没装、`node -v` 通不通。日志被 INTX 静默了，排查时可临时用备用脚本 `启动本地ComfyUI网关.ps1` 手动跑，看它报什么错。
- **如果模型列表是空的**：说明 ComfyUI 没连上，或本机缺工作流需要的模型/节点。打开 `http://127.0.0.1:8190/admin` 看缺什么，或先只保留一个你确定能跑的工作流。

---

## 第 5 步：打开设置页确认状态（渠道自动接入，不用手动加）

打开 INTX → **设置 → 本地 ComfyUI**。这里会显示网关和 ComfyUI 的实时状态：

| 面板显示 | 含义 | 怎么办 |
|---|---|---|
| ComfyUI 未启动 | 网关在跑，但连不上 8188 | 启动 ComfyUI |
| 网关不可达 | 8190 没响应 | 查网关目录位置 / `node_modules` / `node -v` |
| 正在扫描 | 网关正在核对模型与节点 | 等它自动刷新，不用点 |
| 有可用工作流 | 可以出图 | 直接去画布选模型 |
| 无可用工作流 | 逐条列出缺哪个模型/节点 | 补齐依赖后点「重新扫描」 |

**不需要手动新建渠道。** 只要有可用工作流，INTX 会自动维护一个固定 id 为 `local-comfyui` 的 OpenAI 渠道（Base URL `http://127.0.0.1:8190`、Key `local`、direct）。模型能力按网关返回的类型自动映射：`image-` 类进图片模型、`video-` 类进视频模型。可用工作流清空时，这个内置渠道会自动消失。

> 这个内置渠道是自动生成的。手动改它（比如改 Base URL、删模型）会在下次刷新时被覆盖——要调就调网关，别改这个渠道。

---

## 第 6 步：验证出图

画布新建一个图片节点 → 模型选 `本地 ComfyUI` 下的 `image-...` → 输入提示词 → 生成。

第一次可能要等它加载模型，比较慢，属正常。

---

## 排错表

| 现象 | 原因 | 处理 |
|---|---|---|
| 设置页显示「无可用工作流」 | ComfyUI 没启动，或缺模型/节点 | 先开 8188；按面板列出的缺失项补齐后点「重新扫描」 |
| 设置页显示「网关不可达」 | 网关没自动起 | 先用 curl 确认 8190 通；不通就查网关目录位置 / `node_modules` / `node -v` |
| 401 / 403 | Key 没填 | API Key 填 `local` |
| 浏览器里报 CORS | 来源不在白名单 | 把 INTX 的实际地址加进 `CORS_ORIGINS`（需改代码里的 env 或临时用备用脚本起网关） |
| 提交后一直转圈 | 工作流在跑或卡住 | 临时用备用脚本手动起网关看日志；ComfyUI 那边看队列 |
| 视频能提交但拿不到结果 | 响应结构可能和 INTX 预期不同 | **先只验图片**，视频需要单独核对轮询字段 |

---

## 几个必须知道的点

1. **先只验图片。** 图片接口（`/v1/images/generations`、`/v1/images/edits`）和 INTX 的实现完全对得上；视频的轮询/结果结构两边可能有差异，需要单独验，别一上来就测视频。
2. **网关目录随桌面端打包。** 仓库根 `comfyui-gateway/` 会随桌面端一起打包进资源目录；ComfyUI 本身不进包，仍是你自己装。对外分发前，自行确认该网关目录与 ComfyUI（GPL-3.0）的许可证边界。
3. **网关随 INTX 起停。** 打开 INTX 自动拉起、关闭自动回收，不用做成开机自启。ComfyUI 仍需你自己开（它吃显存，不适合跟着 INTX 反复启停）。
4. **这是「自用接入」，不是「内置 ComfyUI」。** 换成别人用，就得处理安装引导、模型下载，那是另一套工作量。
5. **内置渠道自动维护，别手改。** 固定 id `local-comfyui`，可用工作流变化时自动更新/消失；手动改它会在下次刷新被覆盖。
6. **两个已知边界。** ①INTX 异常崩溃（非正常关闭）时网关进程可能残留：下次开 INTX 会接管、不重复起，但退出时也不会关它，必要时手动结束 `node`；②若 8190 被别的程序占用，INTX 会误判「网关已在跑」而不启动，设置页显示「网关不可达」，先释放 8190。

---

## 如果验证通过，下一步

- **补视频链路。** 图片跑通后再单独核对 `/v1/videos` 的提交 / 轮询 / 取内容字段，必要时补适配。
- **考虑内置启动器。** 想让用户完全不手动开 ComfyUI，才做一键拉起 + 模型分发，那要碰打包和显存管理。
- 工作流缺依赖目前只展示缺失项、不自动补齐；需要的话再做资源下载器。
