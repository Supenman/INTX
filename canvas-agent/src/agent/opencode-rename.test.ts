import assert from "node:assert/strict";
import test from "node:test";

import { renameOpencodeRequest } from "./opencode.js";

const BASE = "http://127.0.0.1:4096";

test("重命名走 PATCH /session/{id}，标题放进 JSON 载荷", () => {
    const { url, init } = renameOpencodeRequest(BASE, "ses_abc", "第一镜 · 雨夜街头");
    assert.equal(url, `${BASE}/session/ses_abc`);
    assert.equal(init.method, "PATCH");
    assert.deepEqual(init.headers, { "content-type": "application/json" });
    assert.deepEqual(JSON.parse(String(init.body)), { title: "第一镜 · 雨夜街头" });
});

test("会话 id 做 URL 编码，斜杠与空格不会破坏路径", () => {
    const { url } = renameOpencodeRequest(BASE, "ses/a b", "x");
    assert.equal(url, `${BASE}/session/ses%2Fa%20b`);
});

test("标题原样传给 opencode，不做 trim 也不改写——空值由 HTTP 层拦", () => {
    const { init } = renameOpencodeRequest(BASE, "ses_1", "  保留两侧空格  ");
    assert.deepEqual(JSON.parse(String(init.body)), { title: "  保留两侧空格  " });
});

test("标题含引号、换行、中文与 emoji 时 JSON 仍是合法载荷", () => {
    const title = '他说 "开场"，然后\n切镜 🎬';
    const { init } = renameOpencodeRequest(BASE, "ses_1", title);
    const body = String(init.body);
    assert.deepEqual(JSON.parse(body), { title });
    assert.ok(!body.includes("\n"), "换行必须被转义，不能原样进请求体");
});

test("每次调用返回新的 init 对象，调用方改动不会串到下一次", () => {
    const first = renameOpencodeRequest(BASE, "ses_1", "a");
    const second = renameOpencodeRequest(BASE, "ses_1", "b");
    assert.notEqual(first.init, second.init);
    (first.init as { method?: string }).method = "POST";
    assert.equal(second.init.method, "PATCH");
});
