# INTX 分发与更新机制借鉴方案

> 来源：对照 `1314521gjy/ComfyUI-Local-Infinite-Canvas`（MIT）的实际实现，结合 INTX 现状整理。
> 目的：补齐 INTX 卡住的「Windows 安装包 / 应用内更新」环节。
> 状态：**代码链路已落地，待 Windows 真机验收 + 首次签名发布**。

## 落地修正说明（重要）

最初建议的「文件夹增量更新 web/dist」对 INTX **不成立**：INTX 是 Tauri 桌面壳，前端 `dist` 在构建期内嵌进 exe（`frontendDist` + custom-protocol），安装目录里没有可被覆盖的前端文件夹。那是参考项目那种「文件夹版」应用才有的条件。

因此实际采用 **Tauri 官方 updater（整包更新）**：检查 `latest.json` → 校验签名 → 下载安装包 → 安装。破坏性操作交给 Tauri 的事务式安装器，无需自研备份/回滚。参考项目真正借鉴过来的是「manifest + 校验」思路，以及「密钥扫描 / 用户数据不覆盖」的纪律。

> 代价：强制签名，需要一对密钥 + GitHub 公开 Release。自用阶段这两项是发布前置条件，见下方「发布清单」。

## 一、结论先行

INTX 的 `tauri.conf.json` 已配好 `bundle.targets: "all"`，版本弹窗也有「检查更新」按钮，但**这条链路是断的**：

- 没有 `tauri-plugin-updater`，没有 `update.json`，版本弹窗只从 GitHub 读 changelog 展示，**没有真正的下载/安装**。
- HANDOFF 记录 Windows 安装包「未开始」，这是 M2.5 唯一硬缺口。

参考项目把这件事拆成了两块成熟机制，恰好分别对应 INTX 的两种分发形态：

| 参考项目机制 | 适用 INTX 场景 | 优先级 |
|---|---|---|
| `update.json` + 补丁包 + sha256 + 回滚 | **Git/文件夹安装的增量更新**，体积可控 | 高（先做） |
| Tauri 原生 updater（可另加） | 未来正式 MSI/NSIS 安装的整包升级 | 低（分发启动后再说） |

**建议：先做「文件夹增量更新」，别一上来碰 Tauri 原生 updater。** 理由是它不需要签名、不需要更新服务器、和 INTX 现有的 GitHub release 发布节奏兼容，是投入最小、最快让「安装包」这件事闭环的路径。

## 二、参考项目的核心设计（可直接借鉴）

### 1. 补丁生成 `tools/build-patch.mjs`（238 行）

关键约束，全部值得照搬：

- **发布前置校验**：`VERSION`、`CHANGELOG.md` 必须含当前版本号；`web/dist` 的 JS 里必须能找到版本号，否则拒绝打包。→ 杜绝「改了版本但没重新构建 dist」。
- **白名单 INCLUDE**：只打程序文件（VERSION、CHANGELOG、launcher、gateway/src、web/dist 等）。
- **黑名单 EXCLUDE**：`data/`、`models/`、`node_modules/`、`config.json`、`.env`、各种私钥/证书后缀、`web/dist/config.js`（运行时生成）——四道防线防覆盖用户数据与泄密。
- **主动密钥扫描**：打补丁前正则扫 `sk-`、`ghp_`、AWS key、私钥块、`apiKey/password` 赋值，命中真实密钥直接中止。
- **打包后二次校验**：解压后检查禁止路径、检查 dist 入口引用的 JS/CSS 真的在补丁里。
- **产物**：`patches/vX.zip` + 自动回写 `update.json` 的 `sha256` / `size`。

### 2. 更新应用 `comfyui-gateway/src/update.js`（877 行）

`applyArchivePatch()` 是精髓（407–544 行），一个**带事务语义的补丁应用器**：

1. 下载 → 校验 size → 校验 sha256 → 解压到 staging。
2. `PATCH_PROTECTED` 白名单（83–100 行）：明确列出绝不动的路径（用户数据、依赖、配置、自身更新器）。
3. 写 `.pending.json` 标记 → 逐个备份现有文件到 `.update-backup/<version>/` → 覆盖。
4. **崩溃恢复**：下次启动读 `.pending.json`，把备份回滚回去（546 行起）。这是「更新到一半断电」的兜底。
5. 失败即回滚：`catch` 里把已写文件删掉、备份还原、删 pending 标记。
6. 特殊数据保护：workflow JSON 若本地 hash 不在官方基线里（说明用户改过），**保留本地不覆盖**。

### 3. 清单 `update.json`

version / publishedAt / notes / patch{url,sha256,size} / 镜像。简洁，前端和网关共用。

## 三、INTX 落地方案（分阶段）

### 已落地的代码链路

| 层 | 文件 | 改动 |
|---|---|---|
| Rust | `Cargo.toml` | 加 `tauri-plugin-updater` |
| Rust | `src-tauri/src/lib.rs` | 注册 updater 插件 |
| 配置 | `src-tauri/tauri.conf.json` | `plugins.updater`（endpoints 指向 GitHub `latest.json` + pubkey 占位）、`bundle.createUpdaterArtifacts: true` |
| 权限 | `capabilities/default.json` | 加 `updater:default` |
| 前端 | `package.json` | 加 `@tauri-apps/plugin-updater` |
| 前端 | `hooks/use-version-check.ts` | 桌面端 `check()` → `downloadAndInstall()`，带进度；失败静默降级 |
| 前端 | `version-release-modal.tsx` | 有可用更新时显示「下载更新」按钮 + 二次确认 + 进度条 |
| 文案 | i18n `zh-CN` / `en-US` | 更新相关文案 |
| 工具 | `web/scripts/generate-updater-keys.mjs` | 调官方 CLI 生成签名密钥对 |

**关键设计**：

- 保留原 changelog 展示（读 raw `VERSION`/`CHANGELOG.md`），新增的真实更新链路独立判断。两者互不影响：即使未配 pubkey 或未发布 release，依旧能看更新日志。
- `check()` 的所有异常（占位 pubkey / 404 / 浏览器 dev 环境）一律降级为「无可安装更新」，不打扰用户。
- 只在桌面端（`runtime === "desktop"`）检测更新；浏览器 dev 不走这条链路。
- 用户数据零风险：Key 在浏览器 localStorage、画布在 IndexedDB，整包安装不触碰这些数据。

### 发布清单（代码之外的前置条件，必须做才能真正收到更新）

代码链路只是"能检查能装"，但**没有签名发布就检测不到任何更新**。以下步骤在 Windows 发布机上做一次：

1. **生成密钥对**：`cd web && node scripts/generate-updater-keys.mjs`（调 `tauri signer generate`，会提示设私钥密码）。产物在 `~/.intx-updater.key`（私钥）和 `.pub`（公钥）。**私钥绝不入库、绝不外发。**
2. **填公钥**：把 `.pub` 内容填进 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，替换占位符，提交。
3. **仓库转公开**：`use-version-check.ts` 和 `env.ts` 都注明仓库目前 private、raw 链接会 404。Tauri updater 的 `latest.json` 也要求公开可访问。
4. **签名打包**（先按 HANDOFF 把 `bundle.targets` 从 `"all"` 收敛为 Windows 目标）：
   - PowerShell：`$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content ~/.intx-updater.key -Raw`；`$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '<密码>'`；`pnpm tauri:build`
   - 产物在 `src-tauri/target/release/bundle/`，含安装包和对应的 `.sig` 文件。
5. **写 latest.json**（Tauri 标准格式，示例）：
   ```json
   {
     "version": "0.2.1",
     "notes": "本次更新说明",
     "pub_date": "2026-11-23T00:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<安装包 .sig 文件的完整内容文本，不是路径>",
         "url": "https://github.com/Supenman/INTX/releases/download/v0.2.1/INTX_0.2.1_x64-setup.exe"
       }
     }
   }
   ```
   > 字段是 `pub_date`（RFC 3339）、`signature`（.sig 文件正文）、`url`；`platforms` 的 key 必须是 Tauri 的 target 名（Windows 为 `windows-x86_64`）。`bundle.createUpdaterArtifacts: true` 已配好，打包时才会生成 `.sig`。
6. **发 GitHub Release**：tag 打 `v0.2.1`，把安装包、`.sig`、`latest.json` 一起上传。`endpoints` 会自动命中 `releases/latest/download/latest.json`。

**验收标准**：干净 Windows 上装旧版 → 打开版本弹窗 → 检测到新版 → 二次确认 → 下载安装成功（签名校验通过）→ 重启是新版；用户本地素材/Key 不丢；篡改安装包会导致校验失败、安装中止。

### 待办（发布前置，非代码）

- [ ] 仓库转公开
- [ ] 生成签名密钥对、填公钥、私钥密码妥善保管
- [ ] `bundle.targets` 收敛为 Windows 目标
- [ ] 首次签名打包 + 发 GitHub Release + 上传 latest.json
- [ ] 干净 Windows 真机验收（含篡改包校验失败）

## 四、风险与权衡

| 风险 | 说明 | 对策 |
|---|---|---|
| 许可边界 | 参考项目 MIT，可借鉴代码，但需保留署名；INTX 另有 BeefTV「只参考禁抄」约束，别混为一谈 | 借鉴更新机制时在本项目 `THIRD_PARTY_NOTICES.md` 注明来源；只借鉴思路则无需 |
| 架构差异 | INTX 无 ComfyUI 网关层，参考项目的「网关触发更新」不适用 | 改为 Tauri 命令 / 前端 manifest，核心的「校验+备份+回滚」逻辑通用 |
| 密钥安全 | 签名私钥泄露 = 任何人可推送假更新；用户 API Key 不能被更新流程触碰 | 私钥留在发布机、绝不入库；整包安装不碰浏览器本地的 Key 与画布数据 |
| 发布门槛 | 强制签名 + 公开 Release，自用阶段也要做 | 已提供 `generate-updater-keys.mjs` 与发布清单；未配置时前端静默降级、不影响使用 |

## 五、参考文件索引

clone 位置：`/workspace/ref-comfy-canvas`（稀疏检出，核心源码已通过 API 另存至 `analyze/`）：

- `analyze/build-patch.mjs` — 补丁生成、密钥扫描、清单回写
- `analyze/update.js` — `applyArchivePatch`、PATCH_PROTECTED、崩溃恢复、回滚
- `analyze/tasks.js`、`analyze/registry.js` — 任务/工作流抽象（非本次重点）
- 在线：[仓库](https://github.com/1314521gjy/ComfyUI-Local-Infinite-Canvas) · [网关 README](https://github.com/1314521gjy/ComfyUI-Local-Infinite-Canvas/blob/main/comfyui-gateway/README.md)
