import { describe, expect, it } from "vitest";
import { chainStepDisposition, orderUpstreamChain } from "./chain";

const nodes = ["a", "b", "c", "end", "other"].map((id) => ({ id }));
const edge = (fromNodeId: string, toNodeId: string) => ({ fromNodeId, toNodeId });

describe("upstream chain", () => {
    it("orders shared ancestors once and keeps unrelated nodes out", () => {
        const result = orderUpstreamChain(nodes, [edge("a", "b"), edge("a", "c"), edge("b", "end"), edge("c", "end")], "end");
        expect(result.ok && result.nodes.map(({ id }) => id)).toEqual(["a", "b", "c", "end"]);
    });

    it("rejects cycles and dangling incoming links", () => {
        expect(orderUpstreamChain(nodes, [edge("a", "end"), edge("end", "a")], "end")).toEqual({ ok: false, issue: "cycle" });
        expect(orderUpstreamChain(nodes, [edge("missing", "end")], "end")).toEqual({ ok: false, issue: "missing" });
    });

    it("reuses saved output and blocks running or potentially charged attempts", () => {
        expect(chainStepDisposition(true)).toBe("reuse");
        expect(chainStepDisposition(false, { status: "canceled" })).toBe("generate");
        expect(chainStepDisposition(false, { status: "running" })).toBe("blocked");
        expect(chainStepDisposition(false, { status: "failed", upstreamRef: "old-task" })).toBe("blocked");
        expect(chainStepDisposition(false, { status: "failed", error: { code: "submission_uncertain" } })).toBe("blocked");
        expect(chainStepDisposition(false, { status: "succeeded" })).toBe("blocked");
    });
});
