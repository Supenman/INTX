import { readTaskOutcome, type OutcomeSource } from "../task/outcome";

type ChainNode = { id: string };
type ChainEdge = { fromNodeId: string; toNodeId: string };

export function orderUpstreamChain<T extends ChainNode>(nodes: readonly T[], edges: readonly ChainEdge[], endId: string) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const incoming = new Map<string, string[]>();
    for (const edge of edges) {
        const sources = incoming.get(edge.toNodeId) ?? [];
        sources.push(edge.fromNodeId);
        incoming.set(edge.toNodeId, sources);
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const ordered: T[] = [];
    function visit(id: string): "cycle" | "missing" | undefined {
        if (visiting.has(id)) return "cycle";
        if (visited.has(id)) return;
        const node = byId.get(id);
        if (!node) return "missing";
        visiting.add(id);
        for (const source of incoming.get(id) ?? []) {
            const issue = visit(source);
            if (issue) return issue;
        }
        visiting.delete(id);
        visited.add(id);
        ordered.push(node);
    }

    const issue = visit(endId);
    return issue ? { ok: false as const, issue } : { ok: true as const, nodes: ordered };
}

export function orderUpstreamChains<T extends ChainNode>(nodes: readonly T[], edges: readonly ChainEdge[], endIds: readonly string[]) {
    const ordered: T[] = [];
    const included = new Set<string>();
    for (const endId of endIds) {
        const chain = orderUpstreamChain(nodes, edges, endId);
        if (!chain.ok) return chain;
        for (const node of chain.nodes) {
            if (included.has(node.id)) continue;
            included.add(node.id);
            ordered.push(node);
        }
    }
    return { ok: true as const, nodes: ordered };
}

export function chainStepDisposition(hasResult: boolean, task?: OutcomeSource) {
    const outcome = readTaskOutcome(task);
    // 先判结果，再判任务态。顺序反了会把「已经有可用产出、只是上次重发需确认」的节点
    // 标成 blocked，用户会以为这个镜头坏了；复用已有结果不涉及任何重发，不会放松 confirm。
    if (hasResult) return "reuse";
    if (task && (!outcome || outcome.regenerate !== "allowed")) return "blocked";
    // A committed success without an available result calls for recovery of that result.
    return outcome?.phase === "ready" ? "blocked" : "generate";
}
