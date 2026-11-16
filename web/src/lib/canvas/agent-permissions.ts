/**
 * Agent 操作的三档权限：直接执行 / 需确认。
 *
 * 为什么需要这一层：`use-agent-bridge` 收到 `run_generation` 就直接调
 * `generateNode`，**一次点击就是一次扣费**。Agent 是被提示词驱动的一串操作，
 * 它可能一口气触发五个节点的生成——用户只按了一次「发送」。
 *
 * 复用项目已有的三档语义（`AgentPermissionMode` = request / automatic / full），
 * 不另造一套：`agent-chat-composer.tsx` 里的 `PermissionModeMenu` 早就画好了
 * 这个选择器，只是从来没接上（没人传 `permissionMode`）。这一层就是它缺的下半截。
 *
 * 映射关系：
 * - `request`   每次都问 → 除了纯只读（视口/选中），其余全部 confirm
 * - `automatic` 常规自动、花钱和删除仍问 → 本层默认
 * - `full`      全自动 → 连扣费也不问
 *
 * 判定只看 op 类型，不看提示词内容——解析文案判意图很脆，
 * 上游模型换个说法就绕过去了。类型是契约，文案不是。
 */
import type { CanvasAgentOp } from "./canvas-agent-ops";
import type { AgentPermissionMode } from "@/stores/use-agent-store";

/** 类型也从这里转发一份，调用方只认权限模块，不必知道它住在 store 里。 */
export type { AgentPermissionMode } from "@/stores/use-agent-store";

/** `auto` 直接执行，`confirm` 先问用户。没有第三态：拦死等于让用户以为 Agent 坏了。 */
export type AgentOpDecision = "auto" | "confirm";

export interface AgentOpVerdict {
    op: CanvasAgentOp;
    decision: AgentOpDecision;
    /** 机器码，UI 按它挑文案，不解析中文。 */
    reason: "costs_money" | "destructive" | "reversible" | "any_change";
}

export interface AgentPlanVerdict {
    verdicts: AgentOpVerdict[];
    /** 一定要用户点头的部分。空数组表示可以直接执行。 */
    pending: AgentOpVerdict[];
    /** 只有 pending 非空才需要弹卡；单独给一个布尔，调用方不必再数一次。 */
    requiresConfirmation: boolean;
}

/** 会花钱的 op。`run_generation` 是唯一直接扣费的类型。 */
export function opCostsMoney(op: CanvasAgentOp): boolean {
    return op.type === "run_generation";
}

/** 删东西或覆盖已有产物的 op。撤销快照能救，但用户未必意识到丢了什么。 */
export function opIsDestructive(op: CanvasAgentOp): boolean {
    if (op.type === "delete_node") return true;
    if (op.type === "delete_connections") return Boolean(op.all);
    return false;
}

/** 完全不改变画面的 op：只是挪视口或改选中态，跑完用户看不出区别。 */
export function opIsReadOnly(op: CanvasAgentOp): boolean {
    return op.type === "set_viewport" || op.type === "select_nodes";
}

function decideOne(op: CanvasAgentOp, mode: AgentPermissionMode): AgentOpVerdict {
    // 只读性质的 op 任何模式下都不打扰：每次都问会把确认卡变成噪音，
    // 用户被烦到之后会条件反射地点「确认」，那比不问更危险。
    if (opIsReadOnly(op)) return { op, decision: "auto", reason: "reversible" };

    if (mode === "full") return { op, decision: "auto", reason: "reversible" };
    if (opCostsMoney(op)) return { op, decision: "confirm", reason: "costs_money" };
    if (opIsDestructive(op)) return { op, decision: "confirm", reason: "destructive" };
    // request：任何会改画面的操作都要点头
    if (mode === "request") return { op, decision: "confirm", reason: "any_change" };
    return { op, decision: "auto", reason: "reversible" };
}

/** 把一批 op 收敛成「哪些直接跑、哪些要问」。 */
export function planAgentOps(ops: readonly CanvasAgentOp[], mode: AgentPermissionMode): AgentPlanVerdict {
    const verdicts = ops.filter((op): op is CanvasAgentOp => Boolean(op?.type)).map((op) => decideOne(op, mode));
    const pending = verdicts.filter((verdict) => verdict.decision === "confirm");
    return { verdicts, pending, requiresConfirmation: pending.length > 0 };
}

/** 只保留可以直接执行的 op。confirm 的一律不进执行队列。 */
export function executableOps(plan: AgentPlanVerdict): CanvasAgentOp[] {
    return plan.verdicts.filter((verdict) => verdict.decision === "auto").map((verdict) => verdict.op);
}

/**
 * 用户点确认后要执行的清单：**只有待确认那部分**。
 *
 * 这里绝不能返回全量——`applyAgentOps` 已经把 `executableOps` 里的 op 当场跑过了，
 * 再回放全量会把新节点加两遍、生成任务下两单。
 */
export function confirmedOps(plan: AgentPlanVerdict): CanvasAgentOp[] {
    return plan.pending.map((verdict) => verdict.op);
}

/**
 * 三档取值的**唯一定义**。这里只用 `import type` 拿 store 的类型（编译后被擦除），
 * 不用值导入——否则 domain 层的测试会被迫加载整个 store 和 i18n。
 */
export const AGENT_PERMISSION_MODES = ["request", "automatic", "full"] as const;

export function isAgentPermissionMode(value: unknown): value is AgentPermissionMode {
    return typeof value === "string" && (AGENT_PERMISSION_MODES as readonly string[]).includes(value);
}
