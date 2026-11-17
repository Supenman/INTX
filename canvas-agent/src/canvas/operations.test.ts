import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCanvasToolRequest } from "./operations.js";
import type { CanvasSnapshot } from "./types.js";

function opsOf(name: Parameters<typeof buildCanvasToolRequest>[0], input: Record<string, unknown>, state: CanvasSnapshot | null = null) {
    const request = buildCanvasToolRequest(name, input, state);
    return (request.input as { ops: Array<Record<string, any>> }).ops;
}

test("generation flow creates one generation node and connects references to it", () => {
    const ops = opsOf("canvas_generate_image", { prompt: "a cat on a roof", referenceNodeIds: ["text-1"], autoRun: true });
    const added = ops.filter((op) => op.type === "add_node");
    assert.equal(added.length, 1);
    assert.equal(added[0].nodeType, "image");
    assert.equal(added[0].metadata.prompt, "a cat on a roof");
    assert.equal(added[0].metadata.generationMode, "image");
    assert.deepEqual(ops.filter((op) => op.type === "connect_nodes").map((op) => [op.fromNodeId, op.toNodeId]), [["text-1", added[0].id]]);
    assert.deepEqual(ops.filter((op) => op.type === "select_nodes").map((op) => op.ids), [[added[0].id]]);
    const runs = ops.filter((op) => op.type === "run_generation");
    assert.equal(runs.length, 1);
    assert.equal(runs[0].nodeId, added[0].id);
    assert.equal(runs[0].mode, "image");
    assert.equal(runs[0].prompt, "a cat on a roof");
});

test("generation flow uses the node type of the requested mode", () => {
    const ops = opsOf("canvas_create_generation_flow", { mode: "text", prompt: "写一段文案" });
    const added = ops.filter((op) => op.type === "add_node");
    assert.equal(added.length, 1);
    assert.equal(added[0].nodeType, "text");
    assert.equal(ops.filter((op) => op.type === "run_generation").length, 0);
});

test("generation flow replaces node tokens with snapshot node titles", () => {
    const state: CanvasSnapshot = { nodes: [{ id: "text-1", type: "text", title: "海报标题", position: { x: 0, y: 0 }, width: 320, height: 240 }] };
    const ops = opsOf("canvas_generate_image", { prompt: "把 @[node:text-1] 和 @[node:missing] 画成海报" }, state);
    assert.equal(ops[0].metadata.prompt, "把 海报标题 和 画成海报");
});

test("generation flow drops tokens for connected references so upstream content is not duplicated", () => {
    const state: CanvasSnapshot = { nodes: [{ id: "text-1", type: "text", title: "海报标题", position: { x: 0, y: 0 }, width: 320, height: 240 }] };
    const ops = opsOf("canvas_generate_image", { prompt: "参考 @[node:text-1] 画一张海报", referenceNodeIds: ["text-1"] }, state);
    assert.equal(ops[0].metadata.prompt, "参考 画一张海报");
});

test("generation flow only auto-runs text when a prompt remains after resolving tokens", () => {
    const state: CanvasSnapshot = { nodes: [{ id: "text-1", type: "text", title: "标题", position: { x: 0, y: 0 }, width: 320, height: 240 }] };
    const ops = opsOf("canvas_create_generation_flow", { mode: "text", prompt: "@[node:text-1]", referenceNodeIds: ["text-1"], autoRun: true }, state);
    assert.equal(ops.filter((op) => op.type === "run_generation").length, 0);
});
