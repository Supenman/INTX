/**
 * Agent 三档权限的判定表。
 *
 * 重点不在「能跑」，在「该拦的必须拦住」：`run_generation` 是唯一直接扣费的
 * op，拦不住就等于 Agent 可以用一次对话替用户下 N 单。所以每条断言都盯着
 * 「它不会自己跑」。
 *
 * 三档沿用项目原有的 `request / automatic / full`（输入框右下角那个菜单），
 * 不另造一套命名。
 */
import { describe, expect, it } from "vitest";

import type { CanvasAgentOp } from "./canvas-agent-ops";
import { AGENT_PERMISSION_MODES, confirmedOps, executableOps, isAgentPermissionMode, opCostsMoney, opIsDestructive, opIsReadOnly, planAgentOps } from "./agent-permissions";

const gen = (nodeId = "n1"): CanvasAgentOp => ({ type: "run_generation", nodeId, mode: "image" });
const addNode: CanvasAgentOp = { type: "add_node", id: "n2", nodeType: "image" };
const connect: CanvasAgentOp = { type: "connect_nodes", fromNodeId: "n1", toNodeId: "n2" };
const delNode: CanvasAgentOp = { type: "delete_node", ids: ["n1"] };
const delAll: CanvasAgentOp = { type: "delete_connections", all: true };
const moveViewport: CanvasAgentOp = { type: "set_viewport", viewport: { x: 0, y: 0, k: 1 } };
const selectNodes: CanvasAgentOp = { type: "select_nodes", ids: ["n1"] };

describe("op 分类", () => {
    it("只有 run_generation 会花钱", () => {
        expect(opCostsMoney(gen())).toBe(true);
        for (const op of [addNode, connect, delNode, moveViewport, selectNodes]) {
            expect(opCostsMoney(op), op.type).toBe(false);
        }
    });

    it("删除与覆盖算破坏性，新增与连线不算", () => {
        expect(opIsDestructive(delNode)).toBe(true);
        expect(opIsDestructive(delAll)).toBe(true);
        expect(opIsDestructive({ type: "delete_node" })).toBe(true);
        expect(opIsDestructive(addNode)).toBe(false);
        expect(opIsDestructive(connect)).toBe(false);
    });

    it("只有视口和选中算纯只读", () => {
        expect(opIsReadOnly(moveViewport)).toBe(true);
        expect(opIsReadOnly(selectNodes)).toBe(true);
        for (const op of [addNode, connect, gen(), delNode]) {
            expect(opIsReadOnly(op), op.type).toBe(false);
        }
    });
});

describe("automatic 模式（默认）：只问花钱和删东西", () => {
    it("生成必须确认，绝不直接执行", () => {
        const plan = planAgentOps([gen()], "automatic");
        expect(plan.pending).toHaveLength(1);
        expect(plan.pending[0].reason).toBe("costs_money");
        expect(executableOps(plan)).toHaveLength(0);
        expect(plan.requiresConfirmation).toBe(true);
    });

    it("批量生成五个节点 → 五个待确认，一个都不许偷偷跑", () => {
        const plan = planAgentOps([gen("a"), gen("b"), gen("c"), gen("d"), gen("e")], "automatic");
        expect(plan.pending).toHaveLength(5);
        expect(executableOps(plan)).toHaveLength(0);
    });

    it("新增节点、连线直接执行，不打扰用户", () => {
        const plan = planAgentOps([addNode, connect], "automatic");
        expect(plan.pending).toHaveLength(0);
        expect(executableOps(plan)).toHaveLength(2);
        expect(plan.requiresConfirmation).toBe(false);
    });

    it("删除要确认，理由是破坏性而不是花钱", () => {
        const plan = planAgentOps([delNode], "automatic");
        expect(plan.pending[0].reason).toBe("destructive");
    });

    it("移动视口和选中不需要确认", () => {
        const plan = planAgentOps([moveViewport, selectNodes], "automatic");
        expect(plan.requiresConfirmation).toBe(false);
        expect(executableOps(plan)).toHaveLength(2);
    });

    it("混合批次：能跑的先跑，花钱的挂着等确认", () => {
        const plan = planAgentOps([addNode, gen(), connect], "automatic");
        expect(executableOps(plan).map((op) => op.type)).toEqual(["add_node", "connect_nodes"]);
        expect(plan.pending.map((verdict) => verdict.op.type)).toEqual(["run_generation"]);
    });
});

describe("request 模式：所有改动都问", () => {
    it("新增节点也要确认", () => {
        const plan = planAgentOps([addNode], "request");
        expect(plan.pending).toHaveLength(1);
        expect(plan.pending[0].reason).toBe("any_change");
        expect(executableOps(plan)).toHaveLength(0);
    });

    it("但纯只读操作不打扰", () => {
        const plan = planAgentOps([moveViewport, selectNodes], "request");
        expect(plan.requiresConfirmation).toBe(false);
        expect(executableOps(plan)).toHaveLength(2);
    });

    it("生成的理由仍标为花钱，不是笼统的「有改动」", () => {
        const plan = planAgentOps([gen()], "request");
        expect(plan.pending[0].reason).toBe("costs_money");
    });

    it("删除的理由仍标为破坏性", () => {
        const plan = planAgentOps([delNode], "request");
        expect(plan.pending[0].reason).toBe("destructive");
    });
});

describe("full 模式：连扣费也不问", () => {
    it("生成直接执行——这是三档里唯一会自己花钱的一档", () => {
        const plan = planAgentOps([gen()], "full");
        expect(plan.pending).toHaveLength(0);
        expect(plan.requiresConfirmation).toBe(false);
        expect(executableOps(plan)).toHaveLength(1);
    });

    it("删除也不问", () => {
        const plan = planAgentOps([delNode, delAll], "full");
        expect(plan.pending).toHaveLength(0);
        expect(executableOps(plan)).toHaveLength(2);
    });
});

describe("确认后的重放清单", () => {
    it("只回放待确认的部分，不把已执行的 op 再跑一遍", () => {
        const plan = planAgentOps([addNode, gen(), connect], "automatic");
        // automatic 下 add_node / connect 已经在 executableOps 里跑过了
        const replayed = confirmedOps(plan).map((op) => op.type);
        expect(replayed).toEqual(["run_generation"]);
        expect(executableOps(plan).map((op) => op.type)).toEqual(["add_node", "connect_nodes"]);
    });

    it("没有待确认时重放清单为空", () => {
        expect(confirmedOps(planAgentOps([addNode], "automatic"))).toHaveLength(0);
    });

    it("request 模式下重放清单覆盖所有非只读改动", () => {
        const plan = planAgentOps([addNode, connect, moveViewport], "request");
        expect(confirmedOps(plan).map((op) => op.type)).toEqual(["add_node", "connect_nodes"]);
    });
});

describe("容错", () => {
    it("空数组和脏数据不会炸", () => {
        expect(planAgentOps([], "automatic").requiresConfirmation).toBe(false);
        const plan = planAgentOps([{ type: undefined } as unknown as CanvasAgentOp, gen()], "automatic");
        expect(plan.verdicts).toHaveLength(1);
    });

    it("只认三个已知模式，脏值不进状态", () => {
        expect(AGENT_PERMISSION_MODES).toEqual(["request", "automatic", "full"]);
        expect(isAgentPermissionMode("automatic")).toBe(true);
        expect(isAgentPermissionMode("full")).toBe(true);
        // 早期版本用过的 auto / manual / readonly 一律不认，免得老缓存值把权限放宽
        expect(isAgentPermissionMode("auto")).toBe(false);
        expect(isAgentPermissionMode("manual")).toBe(false);
        expect(isAgentPermissionMode("readonly")).toBe(false);
        expect(isAgentPermissionMode("yolo")).toBe(false);
        expect(isAgentPermissionMode(null)).toBe(false);
    });
});
