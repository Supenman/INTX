import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_OPENCODE_MODEL, DEFAULT_OPENCODE_MODEL_ID, parseOpencodeModelList, resolveOpencodeModel } from "./opencode-models.js";

const payload = {
    providers: [
        { id: "opencode", name: "OpenCode", models: { "nemotron-3.5-lightning-free": { name: "Nemotron 3.5 Lightning Free" }, "other-free": { name: "Other Free" } } },
        { id: "anthropic", name: "Anthropic", models: { "claude-sonnet-4": { name: "Claude Sonnet 4" } } },
    ],
    default: { opencode: "other-free", anthropic: "claude-sonnet-4" },
};

test("归一化 /config/providers：拼接 provider/model id，保留展示名", () => {
    const list = parseOpencodeModelList(payload);
    assert.deepEqual(list.models.map((item) => item.id), [
        "opencode/nemotron-3.5-lightning-free",
        "opencode/other-free",
        "anthropic/claude-sonnet-4",
    ]);
    assert.equal(list.models[0].label, "OpenCode · Nemotron 3.5 Lightning Free");
    assert.deepEqual(list.models[2], { id: "anthropic/claude-sonnet-4", providerID: "anthropic", modelID: "claude-sonnet-4", label: "Anthropic · Claude Sonnet 4" });
});

test("默认项优先沿用今天的固定免费模型，而不是 opencode 的 default 映射", () => {
    assert.equal(parseOpencodeModelList(payload).defaultId, DEFAULT_OPENCODE_MODEL_ID);
});

test("列表里没有固定免费模型时，按 default 映射选默认项", () => {
    const list = parseOpencodeModelList({
        providers: [{ id: "anthropic", name: "Anthropic", models: { "claude-sonnet-4": {}, "claude-haiku": {} } }],
        default: { anthropic: "claude-haiku" },
    });
    assert.equal(list.defaultId, "anthropic/claude-haiku");
    assert.equal(list.models[1].label, "Anthropic · claude-haiku");
});

test("没有 default 映射时退到第一项", () => {
    const list = parseOpencodeModelList({ providers: [{ id: "custom", models: { m1: {}, m2: {} } }], default: {} });
    assert.equal(list.defaultId, "custom/m1");
    assert.equal(list.models[0].label, "custom · m1");
});

test("结构异常、空 providers、重复 id 都得到空列表或去重，不抛错", () => {
    for (const bad of [null, undefined, 42, "x", [], {}, { providers: "bad" }, { providers: [null, 1, { id: "" }] }]) {
        assert.deepEqual(parseOpencodeModelList(bad), { models: [], defaultId: "" });
    }
    const duplicate = parseOpencodeModelList({
        providers: [{ id: "p", models: { m: {} } }, { id: "p", models: { m: { name: "dup" } } }],
        default: {},
    });
    assert.equal(duplicate.models.length, 1);
});

test("选中值在列表里才采用，未选择用默认项", () => {
    const list = parseOpencodeModelList(payload);
    assert.deepEqual(resolveOpencodeModel("anthropic/claude-sonnet-4", list), { providerID: "anthropic", modelID: "claude-sonnet-4" });
    assert.deepEqual(resolveOpencodeModel(undefined, list), { providerID: "opencode", modelID: "nemotron-3.5-lightning-free" });
});

test("选中值不在列表里时拒绝该值并回退默认模型，不静默使用任意字符串", () => {
    const list = parseOpencodeModelList(payload);
    for (const bad of ["", "not-in-list", "opencode/../../evil", DEFAULT_OPENCODE_MODEL_ID + "/extra"]) {
        assert.deepEqual(resolveOpencodeModel(bad, list), { ...DEFAULT_OPENCODE_MODEL });
    }
});

test("列表为空或请求失败时回退固定默认模型，不阻断对话", () => {
    assert.deepEqual(resolveOpencodeModel("anthropic/claude-sonnet-4", { models: [], defaultId: "" }), { ...DEFAULT_OPENCODE_MODEL });
    assert.deepEqual(resolveOpencodeModel(undefined, { models: [], defaultId: "" }), { ...DEFAULT_OPENCODE_MODEL });
});
