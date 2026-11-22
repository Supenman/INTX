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
    id: string;
    name: string;
    type?: string;
    enabled?: boolean;
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
    if (!response.ok) throw new ProviderTransportError("http", `网关返回 ${response.status}`, response.status);
    return (await response.json()) as T;
}

async function postJson<T>(path: string): Promise<T> {
    const response = await transport.request({ method: "POST", url: `${GATEWAY_ORIGIN}${path}` });
    if (!response.ok) throw new ProviderTransportError("http", `网关返回 ${response.status}`, response.status);
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

export { ProviderTransportError };
