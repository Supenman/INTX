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

export function chainStepDisposition(hasResult: boolean, task?: OutcomeSource) {
    const outcome = readTaskOutcome(task);
    if (task && (!outcome || outcome.regenerate !== "allowed")) return "blocked";
    if (hasResult) return "reuse";
    // A committed success without an available result calls for recovery of that result.
    return outcome?.phase === "ready" ? "blocked" : "generate";
}
