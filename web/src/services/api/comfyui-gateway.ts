/**
 * 内置 ComfyUI 网关客户端。
 *
 * 网关由桌面端随 INTX 启动（`web/src-tauri/src/lib.rs` 的 `ManagedLocalGateway`），
 * 固定监听 `127.0.0.1:8190`。这里只做只读查询与手动重扫，不启动/停止网关。
 *
 * 出网走 `createProviderTransport("direct")`：桌面端由 Rust 侧发请求，没有浏览器 CORS
 * 预检，也不经过本地代理，避免 WebView 直连本地接口时的连接误报。
 */
import { createProviderTransport, ProviderTransportError } from "./provider-transport";
import type { ComfyWorkflowContract } from "@/types/comfy-workflow";
import { readApiErrorMessage } from "./provider-errors";

const GATEWAY_ORIGIN = "http://127.0.0.1:8190";

/** 网关在这里是固定本机地址，直连即可，不需要代理模式切换。 */
const transport = createProviderTransport("direct");

/** 工作流可用性问题。type 与网关 `workflow-availability` 一致。 */
export interface WorkflowProblem {
    type: string;
    message: string;
}

export interface WorkflowAvailability {
    available: boolean;
    checking?: boolean;
    stale?: boolean;
    problems?: WorkflowProblem[];
}

/** `/api/workflows` 的单项。 */
export interface GatewayWorkflow {
    draft?: boolean;
    id: string;
    name: string;
    label?: string;
    type?: string;
    enabled?: boolean;
    hidden?: boolean;
    file?: string;
    source?: { kind: string; [key: string]: unknown };
    availability?: WorkflowAvailability;
}

export interface SetupCounts {
    available: number;
    unavailable: number;
    total: number;
}

export interface SetupMissing {
    models?: unknown[];
    nodes?: unknown[];
    uiWorkflows?: number;
    uiSamples?: unknown[];
}

export interface GatewaySetupStatus {
    phase: "idle" | "scanning" | "ready" | "degraded" | string;
    counts?: SetupCounts;
    scanning?: boolean;
    stale?: boolean;
    lastError?: string | null;
    workflows?: Array<{ id: string; name: string; type?: string; available: boolean; problems?: WorkflowProblem[] }>;
    missing?: SetupMissing;
}

export interface GatewayHealth {
    status: string;
    version?: string;
    comfy?: { url: string; reachable: boolean };
    workflows?: { count: number };
    setup?: { phase?: string; counts?: SetupCounts; scanning?: boolean; stale?: boolean };
}

/** `/v1/models` 里每条模型的 metadata（只取本功能用到的字段）。 */
export interface GatewayModelMetadata {
    workflow?: ComfyWorkflowContract;
    type?: string;
    workflowId?: string;
    label?: string;
    description?: string;
    availability?: WorkflowAvailability;
}

export interface GatewayModel {
    id: string;
    object?: string;
    owned_by?: string;
    metadata?: GatewayModelMetadata;
}

async function getJson<T>(path: string): Promise<T> {
    const response = await transport.request({ method: "GET", url: `${GATEWAY_ORIGIN}${path}` });
    if (!response.ok) throw new ProviderTransportError("http", readApiErrorMessage(await response.text()) || `网关返回 ${response.status}`, response.status);
    return (await response.json()) as T;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
    const response = await transport.request({
        method: "POST",
        url: `${GATEWAY_ORIGIN}${path}`,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new ProviderTransportError("http", readApiErrorMessage(await response.text()) || `网关返回 ${response.status}`, response.status);
    return (await response.json()) as T;
}


/** 网关健康检查与 ComfyUI 可达性。 */
export async function fetchGatewayHealth(): Promise<GatewayHealth> {
    return getJson<GatewayHealth>("/health");
}

/** 扫描状态（含计数、缺失项、是否正在扫描）。 */
export async function fetchSetupStatus(): Promise<GatewaySetupStatus> {
    const payload = await getJson<{ ok?: boolean; status?: GatewaySetupStatus }>("/api/setup/status");
    return payload.status || { phase: "idle" };
}

/** 全部工作流及其可用性与缺失项。 */
export async function fetchWorkflows(): Promise<GatewayWorkflow[]> {
    const payload = await getJson<{ workflows?: GatewayWorkflow[] }>("/api/workflows");
    return payload.workflows || [];
}

/** 触发一次手动重扫。网关是异步扫描，返回时扫描可能仍在进行。 */
export async function rescanGateway(): Promise<GatewaySetupStatus> {
    const payload = await postJson<{ ok?: boolean; status?: GatewaySetupStatus }>("/api/setup/scan");
    return payload.status || { phase: "scanning" };
}

/** 当前可用模型（只返回可用工作流包装成的模型）。 */
export async function fetchGatewayModels(): Promise<GatewayModel[]> {
    const payload = await getJson<{ data?: GatewayModel[] }>("/v1/models");
    return payload.data || [];
}

/** 工作流参数绑定：把画布输入映射到 ComfyUI 节点。 */
export interface WorkflowBinding {
    node: string;
    input: string;
    from?: string;
    default?: unknown;
    transform?: string;
    random?: boolean;
    imageIndex?: number;
    [key: string]: unknown;
}

/** 画布可调参数的声明。 */
export interface WorkflowParameter {
    key: string;
    label?: string;
    type?: string;
    default?: unknown;
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
    description?: string;
    [key: string]: unknown;
}

/** 工作流完整定义（详情接口返回）。 */
export interface WorkflowDetail {
    availability?: WorkflowAvailability;
    draft?: boolean;
    inputContract?: boolean;
    outputNodes?: string[];
    id: string;
    name: string;
    label?: string;
    type?: string;
    description?: string;
    file?: string;
    hidden?: boolean;
    bindings?: Record<string, WorkflowBinding>;
    defaults?: Record<string, unknown>;
    presets?: Record<string, unknown>;
    parameters?: WorkflowParameter[];
    source?: { kind: string; [key: string]: unknown };
    importedAt?: string;
}

/** 导入/编辑结果（含自动推断与校验警告）。 */
export interface WorkflowWriteResult {
    ok?: boolean;
    workflow?: WorkflowDetail;
    warnings?: string[];
}

/** 导入用户自己的 ComfyUI API 格式工作流。type 留空则自动识别。 */
export async function importGatewayWorkflow(input: {
    json: unknown;
    name: string;
    type?: "image" | "video" | "audio" | "";
}): Promise<WorkflowWriteResult> {
    const body: Record<string, unknown> = { json: input.json, name: input.name, draft: true };
    if (input.type) body.type = input.type;
    return postJson<WorkflowWriteResult>("/api/workflows/import", body);
}

/** 工作流里的一个 ComfyUI 节点（用于编辑绑定时选择）。 */
export interface WorkflowNode {
    recommendedOutput?: boolean;
    id: string;
    classType: string;
    title: string;
    inputs: string[];
}

/** 读取工作流详情（用于编辑绑定）。 */
export async function fetchWorkflowDetail(id: string): Promise<{ workflow: WorkflowDetail; schema?: unknown; nodes?: WorkflowNode[] }> {
    return getJson<{ workflow: WorkflowDetail; schema?: unknown; nodes?: WorkflowNode[] }>(`/api/workflows/${encodeURIComponent(id)}`);
}

/** 编辑工作流的绑定与参数。 */
export async function updateGatewayWorkflow(
    id: string,
    patch: { label?: string; description?: string; bindings?: Record<string, WorkflowBinding>; parameters?: WorkflowParameter[]; inputContract?: boolean; outputNodes?: string[] },
): Promise<WorkflowWriteResult> {
    return postJson<WorkflowWriteResult>(`/api/workflows/${encodeURIComponent(id)}/update`, patch);
}

/** 删除用户导入的工作流（只删注册表记录，不删源文件）。 */
export async function deleteGatewayWorkflow(id: string): Promise<{ ok: boolean }> {
    const response = await transport.request({ method: "POST", url: `${GATEWAY_ORIGIN}/api/workflows/${encodeURIComponent(id)}/delete` });
    if (!response.ok) throw new ProviderTransportError("http", `网关返回 ${response.status}`, response.status);
    return (await response.json()) as { ok: boolean };
}

/** 显示/隐藏工作流。 */
export async function setGatewayWorkflowVisibility(id: string, enabled: boolean): Promise<{ ok: boolean }> {
    return postJson<{ ok: boolean }>(`/api/workflows/${encodeURIComponent(id)}/visibility`, { enabled });
}

export { ProviderTransportError };
