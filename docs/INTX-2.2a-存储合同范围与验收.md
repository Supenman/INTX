# INTX 2.2a：异步存储合同——范围与验收标准

**状态：2.2a-1 任务、2.2a-2 项目/素材快照存储屏障、2.2a-3 业务成功确认均已实现并已提交到 dev，待用户真机验收。2.2b 本机已收单证据已实现（另阶段，待用户验收，见待测试清单）。以下清单是 2.2a 的完整目标，不代表全部完成。**

对应成熟框架规划的「第二步：可靠持久化与统一桌面网络」。这一小步只解决本地元数据读写的完成语义、错误和并发覆盖，不引入 SQLite，不改厂商协议，不处理凭证。

### 当前 2.2a-1 实施记录

- 已接入任务端口、IndexedDB/内存 repository、任务级 revision 条件事务，以及任务提交和任务号保存的等待链。
- `idb` 锁定 8.0.4，`fake-indexeddb` 锁定 6.2.8；只有任务键改走事务，不修改项目/素材存储。
- task commit/recovery 的非法迁移与保存冲突显式失败；未保存的已知任务证据显示于设置，补记不触发网络。
- 类型、34 文件/499 用例、构建和依赖边界通过；真实浏览器/Tauri 存储点验和真实厂商查单未验证。
- 此处记录仅指已完成的 2.2a-1；2.2a-2 进展见下节，不将以下完整清单全部打勾。

### 当前 2.2a-2 实施记录

- 项目/素材使用当前数据库、app_state 和既有键，取消 Zustand 隐式 persist；业务数据类型搬出 store，保留原导出路径。
- 集合 revision 在同一 readwrite 事务检查、写入并等待完成；首次读取当前格式不改写，读取错误/损坏/未知版本/旧回退键阻止覆盖。
- 项目 400ms 防抖、页面 viewport 500ms 保留；串行保存队列、sequence、flush、显式本地重试和已确认/草稿状态分离。
- 项目页离开前交出最后 viewport 和编辑快照，保存失败阻止路由切换并保留草稿；不同项目异步恢复不互相覆盖。
- 素材媒体恢复仍在事务之外，元数据确认之前不调度媒体删除；项目/素材页面及画布顶部展示加载、未保存、保存中、失败和本地重试入口。
- WebDAV 仅将 hydration 等待改成可失败的 load，避免读取失败后无限等待；其本地 apply 和业务成功提示当时留到 2.2a-3，现已在下一节接通。导入、保存素材、查单取回、Agent 的确认在 2.2a-2 当时尚未接通，不存在跨集合原子提交保证。
- 类型检查通过，自动化回归 40 文件/626 用例通过，domain 依赖边界通过，生产构建通过。未做真实浏览器/Tauri 重启点验，未发真实厂商请求。

### 当前 2.2a-3 实施记录

- 新增业务确认边界 `confirmSave()`：先等待当前草稿事务完成；已有保存失败时明确补写同一 expectedRevision，冲突仍不会被覆盖。项目/素材编辑动作仍同步返回 id，成功文案只在事务完成后显示。
- 已接通画布节点保存、画布侧栏上传/移除、生图与视频工作台保存结果、提示词库/来源弹窗收藏、素材新增/编辑/ZIP 导入/删除、画布 ZIP 导入、项目库批量删除、当前项目删除、Agent `assets_add`。失败保留草稿并提示本地保存失败；删除完成仍只代表元数据，媒体清理继续排在确认之后。
- 查单取回先写素材并 `confirmSave()`，再提交任务；素材保存失败与“素材已保存、任务更新失败”分别提示。同一进程内按任务 id + 上游单号保留已取回素材 id；重试只补写已知任务，不重新查单、下载或重复创建素材；任务确认或本地补写成功后清除证据，任务写失败继续保留。
- WebDAV 本地 apply 在替换项目/素材草稿后等待提交，失败向上返回，不再报完整同步成功；远端合并与传输协议未改。
- 自动化：类型检查通过，42 文件/634 用例通过（含后续补充的素材侧 WebDAV 本地提交失败回归，已提交到 dev），domain 依赖边界通过，生产构建通过（34.4s；仍有 Node 20.18 版本提示、现有大分块和动态导入警告）。新增 Agent 工具确认失败不返回成功、`confirmSave` 失败后补写、恢复素材证据复用/失败保留、WebDAV 落地等待提交与失败返回等回归。真实浏览器/Tauri 的导入、保存、删除、WebDAV 和故障 UI 点验未验证；未发真实厂商请求。

## 1. 本步要交付什么

> 任务、项目、素材都能明确回答：加载成功了吗？这次保存完成了吗？是否被其他写入覆盖了？失败后哪些东西还在内存、哪些已经在本地存储？

交付三项：

1. **可等待的 repository**：业务代码拿到写入成功结果时，IndexedDB 事务已经完成，而不是仅修改了 Zustand。
2. **有版本的条件更新**：旧快照不能无条件覆盖新数据；非法任务迁移、版本冲突和存储失败都显式返回。
3. **接通业务确认边界**：提交前、拿到任务号后、导入完成、保存素材、WebDAV 本地应用完成，都等待对应写入；不再提前提示「已保存」。

保留 React、Zustand、IndexedDB 及现有编辑体验。Zustand 继续负责显示和编辑草稿，但不再承担这三类数据的隐式自动落盘。

**需要修正前一轮的表述：这不是完全无用户可感知行为的内部重构。** 保存失败会被显示；提交前台账写失败会阻止厂商提交；版本冲突会阻止覆盖。这些是本步有意增加的安全边界。

## 2. 现状与必须跨过的断点

| 对象 | 当前持久化粒度 | 当前问题 | 本步处理 |
|---|---|---|---|
| 任务 | `app_state` 中 `infinite-canvas:intx_task_log` 的整个 tasks 快照 | `TaskLog.create/update` 同步返回，调用方不等待落盘 | 改为异步任务 repository，写入带版本条件 |
| 项目 | `app_state` 中 `infinite-canvas:canvas_store` 的 projects + deletedProjects 快照 | store 有 400ms 防抖，定时器里 `void setItem`；没有保存屏障 | 保留集合快照和防抖值，增加真正可等待的保存及 flush |
| 素材 | `app_state` 中 `infinite-canvas:asset_store` 的 assets 快照 | `addAsset()` 返回 id 后立即提示成功，未确认元数据写入 | 保留同步内存动作，关键调用方等待元数据保存 |
| 共用存储 | `localForageStorage` | IndexedDB 出错时改写 localStorage，掩盖故障并产生另一份数据 | 三类 repository 不再使用这个回退；其他配置/缓存消费者不改 |

源码依据：

- [taskLog.ts](../web/src/services/generation/taskLog.ts:20)：同步 TaskLog 接口；[commit](../web/src/services/generation/taskLog.ts:103) 在非法迁移时直接返回原任务，注释所说的「不静默吞掉」目前并未落实。
- [withTask.ts](../web/src/services/generation/withTask.ts:81)：create、commit、onSubmitted 均没有等待持久化。
- [modelScope.ts](../web/src/services/generation/modelScope.ts:64)：onSubmitted 的当前签名是 void，需要接通异步回调。
- [use-canvas-store.ts](../web/src/stores/canvas/use-canvas-store.ts:48)：集合写入、防抖和同步动作。
- [use-asset-store.ts](../web/src/stores/use-asset-store.ts:45)：素材集合持久化及预览恢复。
- [localforage-storage.ts](../web/src/lib/localforage-storage.ts:9)：读写失败后的 localStorage 回退。
- [config-tasks.tsx](../web/src/components/layout/config-tasks.tsx:89)：取回素材后立即 commitRecovered 和提示成功，两次元数据写入都未被等待。

这些是后续实施要解决的现状，不是「现有数据一定已经丢失」的断言。

## 3. 范围：做什么，不做什么

### 3.1 纳入

**任务**

- 异步 create/get/list/条件 replace，测试内存实现遵循相同合同。
- hydration/初始化可等待；加载失败不伪装成空台账。
- 提交前等待任务快照写入；已有任务号先保存，再进入查询阶段。
- commit、commitRecovered、noteVideoPoll 返回明确的成功或错误，不靠返回旧对象表示失败。
- 应用层从当前版本执行 domain 规则，状态和产物引用随一次条件更新保存。
- 查单后的素材元数据保存成功，才确认任务恢复成功。

**项目和素材元数据**

- 项目继续保存集合快照，含删除墓碑；素材继续保存集合快照。
- repository load/save、集合 revision、保存队列、可等待的 flush。
- 编辑状态与已提交版本分开；普通编辑仍即时响应。
- 创建、导入、删除、保存素材等确认边界等待保存完成。
- 元数据删除成功后才调度现有媒体清理，写失败不能先删掉文件。

**最小 UI 接入**

- 区分加载中、加载失败、未保存、保存中、保存失败/冲突、已保存。
- 首次加载失败时不显示「没有项目/素材/任务」并允许覆盖原数据。
- 保存失败时保留草稿，提供明确的「重试本地保存」；这不是重新生成。
- 切换项目/离开编辑页前交出最新编辑快照并等待屏障；失败不悄悄丢掉草稿。

### 3.2 排除

- SQLite、Rust 数据库命令、文件工作区、桌面数据库迁移和备份体系。
- operationId、dispatch/响应回执、HTTP 统一、厂商幂等与网络自动重试。
- API Key、credentialRef、配置导入导出、系统凭证库。
- 图片/视频原始 Blob 存储、预览生成、文件命名、媒体垃圾回收规则重写。
- 图片/视频工作台日志的存储改造；它们是独立日志仓库，不等于任务台账。
- ZIP 包版本、WebDAV 清单格式、合并算法、认证和网络传输。
- 画布状态管理重写、编辑器拆分、Agent/插件协议调整。
- 凭旧任务号自动关联原画布槽位：当前任务与节点/工作台绑定不足，本步不借存储改造伪造这项能力；取回结果仍进入「我的素材」。
- 视频 in-flight 展示问题等独立行为修复；若异步调用接入必须改到，仅改等待链路。

## 4. 技术选择与完成语义

### 4.1 IndexedDB 仍是唯一存储来源

三类元数据继续使用当前数据库、`app_state` 和既有键，不另建一套权威库，不持续双写。

localforage 的独立 `getItem()` / `setItem()` 没有暴露条件读改写事务。不能用「先读 revision，再 setItem」冒充原子条件更新。

**建议使用成熟的 `idb` 库为这三个键提供 IndexedDB readwrite 事务**，而不是手写事务封装或引入整个 ORM。实施时验证并锁定兼容版本；测试使用 `fake-indexeddb`，同样锁定版本。这是本步拟增加的依赖，不是当前仓库已有依赖。

连接与首次读取必须验证既有 localforage 数据库/对象仓库的实际布局和序列化行为；初始化要协调现有 localforage 连接。不得顺手升级库结构、建第二份记录，或用测试新库替代已有数据的接入验证。

事务只做本地元数据读取、版本检查和写入。HTTP、媒体下载、缩略图恢复、UI 更新不放进事务；否则等待外部异步步骤可能使 IndexedDB 事务提前关闭。

### 4.2 成功只在事务完成后返回

- `request.onsuccess`、内存 set、定时器触发，均不等于完整事务提交成功。
- 保存成功以事务完成为界；事务 abort、配额不足、数据损坏等向上传递。
- 不宣称操作系统断电后绝对耐久，也不宣称本地数据库与厂商请求 exactly-once。
- load 成功、编辑状态 ready、没有待写数据，是三个不同概念。
- 确认存储可用且既有键不存在时，才是合法空集合（revision 0）；不是把读取异常转换成「不存在」。首次提交从 revision 1 开始。

### 4.3 版本是存储版本，不是任务重试次数

- `Task.attempt`、项目 updatedAt、`GenerationParams` 不充当 revision。
- 任务按任务记录带 revision；项目/素材先按实际集合快照带 revision。
- 更新必须携带 expectedRevision；检查和写入位于同一 readwrite 事务。
- 两个并发写入使用同一旧版本，最多一个成功，另一个得到 conflict。
- 任务之间的独立更新不能相互丢失：即使物理上仍是 tasks 数组，也必须事务内读取最新集合，只替换目标任务。
- 项目/素材集合冲突不静默最后写入者获胜，不按时间戳猜哪边正确，也不无限自动覆盖重试。

本步只兑现单任务、单集合的原子更新。**素材集合 + 任务 + 项目 + Blob 不是一个事务**；跨对象产物提交协议属于 2.2c。

## 5. 接口草案

接口放在 application 的端口层，仅包含类型；domain 保持零 IO、零 React。repository 保存数据，任务状态判断仍由 domain/application 执行。

```ts
// 草案；具体命名在实施时沿用项目风格。
type StorageError =
  | { code: 'unavailable' | 'read_failed' | 'write_failed'; message: string }
  | { code: 'corrupt_data' | 'unsupported_format'; message: string }
  | { code: 'conflict'; expectedRevision: number; actualRevision: number }
  | { code: 'not_found' | 'already_exists'; id: string };

type Stored<T> = { value: T; revision: number };
type StorageResult<T> = Result<T, StorageError>;

interface TaskRepository {
  create(task: Task): Promise<StorageResult<Stored<Task>>>;
  get(id: string): Promise<StorageResult<Stored<Task> | null>>;
  list(): Promise<StorageResult<Stored<Task>[]>>;
  replace(
    task: Task,
    expectedRevision: number,
  ): Promise<StorageResult<Stored<Task>>>;
}

// 保持当前聚合粒度，不先拆出空节点表、素材引用表。
interface ProjectRepository {
  load(): Promise<StorageResult<Stored<ProjectSnapshot>>>;
  save(
    value: ProjectSnapshot,
    expectedRevision: number,
  ): Promise<StorageResult<Stored<ProjectSnapshot>>>;
}

interface AssetRepository {
  load(): Promise<StorageResult<Stored<AssetSnapshot>>>;
  save(
    value: AssetSnapshot,
    expectedRevision: number,
  ): Promise<StorageResult<Stored<AssetSnapshot>>>;
}

// ProjectSnapshot = { projects: CanvasProject[]; deletedProjects: ...[] }
// AssetSnapshot   = { assets: Asset[] }
```

补充约束：

- TaskRepository.create 接收由 domain 创建的 Task，不让存储适配器偷偷生成业务状态。
- `Result` 复用现有 [domain/shared/result.ts](../web/src/domain/shared/result.ts)，不新造第二套错误协议。
- 非法 transition/recovery 的领域错误在应用命令里向上传递；不混入网络错误，也不通过保存原对象表示成功。
- 查询上游号可先从 repository 的 list 做纯筛选，不建立「upstreamRef 全厂商唯一」的假设。
- 数据类型不能反向 import Zustand store。必要时仅搬出 CanvasProject/Asset 的数据类型，保留 store 转出，不改字段和模型语义。
- 不公开任意 patch、任意表名、跨库事务回调等万能接口。

### 5.1 Zustand 和 flush 的分工

任务视图订阅已确认快照以及明确标注的未落盘证据；业务写入经 application 命令 → repository。任务同步缓存 list 不再冒充持久化查询。

项目/素材可以保留现有同步动作和立即返回的 id，避免把所有组件变成 async：

- 同步动作只代表内存草稿已更新。
- 保存队列为每次编辑标记本地 sequence；队列不携带任何厂商请求。
- `flush()` 立即提交调用时已经交给队列的最新快照，并等待至少该 sequence 完成；后续新编辑仍可留在队列。
- 被防抖合并的编辑可以由后一个完整快照覆盖保存，但不能让旧快照晚到覆盖新快照。
- 当前项目 store 的 400ms、viewport 的 500ms 保持原值，不新增超时、重试次数或并发上限。
- 页面 viewport 还有未交给 store 的定时更新：离开页面时必须先交出它，再 flush。只 flush store、不处理页面定时器，不算完成。
- 保存中继续编辑时，旧写入结束不能把新草稿的 dirty 状态清掉。
- 未等待保存的同步动作不能直接向用户/Agent 宣称「已持久化」。

## 6. 必须接通的任务顺序

### 6.1 新生成

1. 等待 repository 初始化并读取当前数据。
2. 生成 Task、写入 queued，并确认成功。
3. 用当前任务版本执行 transition，保存 running/submitting，并确认成功。
4. 在准备调用厂商前重新检查取消状态；若此时取消，记录为提交前取消，不发送请求。
5. 仅当上述存储步骤成功，进入现有 submit。**台账写失败时厂商请求数为零。**
6. 异步适配器拿到 upstreamRef 后更新内存证据，并 `await onSubmitted(ref)` 保存它。
7. 任务号保存成功才开始后续查询；ModelScope 和同步分支就地查旧单的回调都要等待。
8. 记录生成结果/失败时，同样等待版本条件保存。

视频 submit/poll 也按同一存储合同接入，保留现有轮询间隔、次数和厂商处理流程。

提交前发生的纯本地保存错误不送入 `normalizeError(..., 'submitting')` 猜测是否出过网：此时尚未调用 submit，应显示「未提交，先处理本地保存」。它不能污染上游错误分类，也不能启动任何自动新提交。

### 6.2 任务号已返回，但本地写失败

这是本步最重要的故障场景：上游可能已扣费，不能把本地 write_failed 当普通请求失败，再诱导新提交。

- 当前进程保留任务号和「未能保存到本地」状态，允许复制任务号。
- 已接受/可能计费的事实不得因台账写失败降成 canceled/allowed；重发判定仍调用 readTaskOutcome。
- 自动提交/重新 POST 一律禁止；后续步骤停止，明确提示本地保存失败。
- 「重试本地保存」只重试保存这份已知快照，不重新发厂商请求。
- 如果随后应用崩溃，这份未保存任务号可能丢失。本步**不能承诺**重启一定查得到；2.2b 的原生响应证据才用于缩小这个窗口。

### 6.3 查单取回

沿用 2.1：只查询原单，不新提交，结果进入我的素材。

1. 查询并下载已有产物，调用现有媒体存储。
2. 写入素材元数据并等待 asset flush 成功。
3. 读取当前任务版本，执行正常成功迁移或受限 recoverPendingResult。
4. 条件保存任务结果；成功后任务才从待核实清单消失并提示取回完成。
5. 第 2/4 步失败要区分「素材未确认保存」和「素材已保存、任务更新失败」。保留已知产物/资产引用，当前进程的本地补记不得重新请求厂商或反复创建相同素材。

跨集合崩溃后的全自动补齐不在本步保证内；不能把「两次 await」写成跨集合原子事务。

## 7. 文件范围

以下为预计改动面，不是空目录建设清单。实施时以调用链为准，不按文件数交付。

### 7.1 核心文件

拟新增：

- `web/src/application/ports/repositories.ts`：合同及错误类型。
- `web/src/application/persistence/types.ts`：仅在避免 store 类型依赖确实需要时抽出数据类型。
- `web/src/infrastructure/storage/indexeddb-repositories.ts`：三个键的实际读写与条件事务。
- `web/src/infrastructure/storage/write-queue.ts`：项目/素材的防抖与 flush，仅一个必要共享实现。
- 对应内存 repository、合同测试、IndexedDB 事务测试；不堆未使用的通用基类。

现有必改：

- `services/generation/taskLog.ts`、`withTask.ts`、`videoTasks.ts`、`index.ts`：接入异步 repository；处理非法迁移和保存错误。
- `services/generation/modelScope.ts`、`services/api/image.ts`、`services/api/video.ts`：等待任务号回调、异步任务读写。
- `stores/canvas/use-canvas-store.ts`、`stores/use-asset-store.ts`：取消这些业务集合的隐式 persist 写入，保留 Zustand 编辑/显示，接 repository 和保存状态。
- `components/layout/config-tasks.tsx`：恢复确认顺序和保存失败展示。

### 7.2 接入点，不重写业务

- `pages/canvas/project.tsx`：自动保存/viewport 交出、离开屏障、另存素材及保存错误。
- `pages/canvas/index.tsx`、项目卡片和删除弹窗：创建/导入/删除的保存确认。
- `pages/assets/index.tsx`、`components/canvas/canvas-side-panel.tsx`：素材保存/导入/删除确认。
- `pages/image/index.tsx`、`pages/video/index.tsx`：只接「保存到素材」和必须适配的任务异步调用，日志存储不重构。
- `pages/prompts/index.tsx`、`components/layout/prompt-source-content-modal.tsx`：收藏到素材成功提示的确认边界。
- `lib/agent/agent-site-tools.ts`：保存素材的工具结果必须等本地提交；不动 Agent 消息协议。
- `services/app-sync.ts`：project/assets 的本地 apply 完成必须等待；其他两个日志域及远端协议不改。
- 必要的中文/英文错误文案、类型、合同测试与 CI 测试路径。

`lib/localforage-storage.ts` 不全局改：三类 repository 绕开其降级行为，其他消费者保持现状。

## 8. 已有数据保护

- 不能删除、清空、截断或重建已有项目/素材/任务集合。
- 沿用现有业务 state 结构和键；revision/存储格式标识放在 repository 的元数据外壳，不挤进 prompt、Task.attempt 或项目节点。
- 现有格式的第一次读取不自动改写；仅识别当前明确存在的格式，旧快照视为初始 revision。第一次成功保存可补入版本元数据，并完整保留业务载荷。
- 这是有限的现有格式接入，不建设历史版本兼容/迁移框架。必须用当前格式样本验证读写前后等价。
- 遇到非法 JSON、未知格式版本、非法字段或加载失败，不按「空集合」继续写。
- 若 IndexedDB 无记录、但检测到这些已知业务键在旧 localStorage 回退中有数据，停止该集合写入并提示存在待处理旧数据；本步不静默合并、删除或自动导入它。
- 不读取配置键、真实 Key 或用户运行时数据做测试；用人工构造的无凭证数据样本。
- 浏览器与桌面各保留自己的 IndexedDB；不承诺两端自动同步。

## 9. 验收标准

下面全部是实施后的通过条件，当前不能标为已通过。

### A. repository 合同

- [ ] 三类写入返回成功前，实际事务已完成；模拟最后阶段 abort 时得到失败，不更新已提交版本。
- [ ] 任务 create/get/list/replace 和项目/素材 load/save 都有可等待结果。
- [ ] 存储拒绝、配额不足、读取失败、损坏数据可观察；不降级到 localStorage，不返回空集合掩盖读取错误。
- [ ] 内存测试实现与 IndexedDB 实现运行同一套合同用例；只验证内存实现不算通过。

### B. revision 与并发

- [ ] 同一任务的两个旧版本更新最多一个成功；落库状态不是两份任意拼接。
- [ ] 两条不同任务同时更新，二者都保留；更新 tasks 数组不能丢掉另一条。
- [ ] 两个独立连接/页面并发保存同一项目/素材集合，旧版本得到 conflict，不覆盖已提交的新版本。
- [ ] 冲突不会自动重跑生成用例、重新 POST，或静默以 updatedAt 较大者覆盖。
- [ ] 同页连续编辑和反向完成的延迟写入，最终保存最新快照；保存中出现新编辑仍保持未保存状态。

### C. 任务与三态

- [ ] 提交前台账 create/状态写入失败，mock transport 的厂商调用次数为零。
- [ ] 等待本地保存期间取消，在真正提交前被再次检查，不发送请求。
- [ ] ModelScope 顺序可被测试观察：任务提交状态保存完成 → 唯一 POST → upstreamRef 保存完成 → GET；没有对付费 POST 的隐式重试。
- [ ] 上游接受后本地写失败，当前进程仍显示任务号与保存失败；readTaskOutcome 不退化成 allowed。
- [ ] 非法 transition/recovery、版本冲突显式失败，调用方不能提示成功或继续依赖未保存状态。
- [ ] 已有三态、取消、ModelScope、多图和视频行为用例保持通过；变化仅来自明确规定的保存确认边界。

### D. 项目与素材

- [ ] load/save 保留所有业务字段、排序、聊天、viewport、项目墓碑和素材引用；不把函数/hydrated/瞬态保存状态写进载荷。
- [ ] 保留当前防抖值；flush 不会等定时器到期才开始写，且覆盖页面最后尚未交出的 viewport。
- [ ] 成功保存后刷新/重开应用，项目、素材和任务从真实 IndexedDB 恢复。
- [ ] 加载失败/未知格式不覆盖原数据；保存失败保留草稿且不提示已保存。
- [ ] 删除元数据失败时，现有媒体清理尚未调度；删除成功仅代表元数据完成，不等于所有 Blob 已清理。

### E. 接入与恢复

- [ ] 项目/素材导入失败不提示成功；导出 ZIP 格式不变，导出仍读明确选定的编辑快照，不变成数据库备份。
- [ ] 保存素材和 Agent 保存工具只有元数据确认后报告成功。
- [ ] 查单恢复的素材写失败或任务更新失败分别展示；失败任务不提前从待核实列表消失。
- [ ] 同进程重试本地补记复用已知产物/素材引用，不重新提交、不重复创建已确认素材。
- [ ] WebDAV 的本地 apply 等待项目/素材提交；写失败不会被上层当完整同步成功，远端合并与传输协议不改。

自动化已覆盖：保存失败后 `confirmSave()` 会补写同一草稿；Agent `assets_add` 事务失败不返回成功；恢复素材证据按任务 id/上游单号复用、任务写失败时保留、确认后清除；WebDAV 本地落地等待提交，提交失败时同步失败。导入、删除和其余 UI 成功边界只有代码接线与类型/构建验证，尚未真机点验。

### F. 工程与真机分开记

- [x] 类型检查、已有 domain/generation 测试、新 repository/事务/保存队列测试及构建通过；CI 包含新测试目录。（2026-11-14 本地通过：2.2a-3 收尾为 42 文件/634 用例；2.2b 后为 43 文件/644 用例；2.2c-2 后当前为 **44 文件/661 用例**，依赖边界与生产构建均通过。CI 命令已加入 Agent 工具与 WebDAV 保存边界测试。）
- [ ] 浏览器和 Tauri 均完成无厂商请求的本地保存/刷新/重启验收，记录实际环境与结果。
- [ ] 损坏/写失败/冲突测试使用独立测试库或受控测试页，不清空用户库、不关闭用户页面。
- [ ] 真实厂商取回仍须用户另行明确授权，不能因批准本步而调用任何真实 Key。

## 10. 实施顺序与停止点

### 2.2a-1：任务写入先变真

- 建立合同、IndexedDB/内存适配和任务保存等待链。
- 接通 onSubmitted、视频台账、commit/recovery 的错误传播。
- 验收 A、B 的任务部分及 C；不先扩到所有画布动作。

**停止点：** create 成功但事务未完成、已收单写失败后仍能直接重发、非法迁移被吞掉，任一出现都不能进入下一段。

### 2.2a-2：项目/素材保持快照，接保存屏障

- 切断这两个集合的隐式 persist 写入，接条件事务、队列、flush 和保存状态。
- 保留现有编辑动作、即时 id、防抖参数和媒体加载职责。
- 验收 B 的集合部分、D。

**停止点：** 双写旧 persist 和新 repository、旧快照覆盖新快照、加载失败被当空库，任一出现都不能迁移调用方确认。

### 2.2a-3：业务成功提示只认真实保存

- 接查单取回、导入、保存素材、删除、Agent 保存工具和 WebDAV 本地 apply。
- 补错误文案、调用链回归测试和用户手工清单。
- 验收 E、F；逐项注明自动化通过或真机未验证。

### 阶段状态（本轮收尾时）

- 2.2a-1、2.2a-2、2.2a-3 均已实现并已提交到 dev；2.2a-3 的补充回归测试为 `daf2e75e`。三段构建级自动化验证通过；四条红线（不重发、查单只读、重启保留、补写不重发）的真机与故障注入集中验收已完成，证据分级见 `docs/INTX-2.2b-2.2c-红线验收记录.md`，本文 §9 A–F 的逐项真机确认仍按 pending-test 清单推进。
- 2.2b 本机已收单证据已提交为 `43e5bd2e`；2.2c-1 已取回素材证据已提交为 `6b3e2b3`。两者都**不属于本文档 2.2a 的合同范围**，只分别缩小 §6.2、§6.3 的崩溃窗口，不改厂商协议、不改主台账格式、不引入跨对象原子事务。验收条目见 `docs/content/docs/progress/pending-test.mdx` 与中文版；三段合并的集中真机验收结果以 `docs/INTX-2.2b-2.2c-红线验收记录.md` 为准（WorkBuddy 云机 `/workspace` 下的旧清单不在本仓库）。
- 2.2c-2「已下载产物补建证据」已实现并已提交为 `6c5c1be`：把证据写入时机提前到 Blob 已写 / 素材元数据未确认，重启后用已下载的本地文件补建素材，收掉 §6.3 表格第 1 行的崩溃窗口；只做补齐，不改媒体存储层与清理策略。
- 2.2c 剩余的「真·跨 store 原子提交」需先把媒体层从 localforage 改成 `idb` 直连，属 §3.2 明确排除项，未开始；媒体垃圾回收策略重写仍在排除范围。真实厂商请求已由用户在桌面端发起一次（happy path，用于红线验收）；尚未覆盖的验收项（ModelScope 图片查单 UI 实测、真实厂商中断路径、打包版 origin）见红线验收记录 §6。不动 master。

## 11. 一句话完成标志

**在现有 IndexedDB 上，任务、项目和素材有真实可等待的保存、原子版本检查与可见失败；保存失败不伪装成功，存储冲突不覆盖新数据，已收单失败不触发新提交。**

这时才能说 2.2a 完成；仅把 `void` 改成 `Promise<void>` 不算。
