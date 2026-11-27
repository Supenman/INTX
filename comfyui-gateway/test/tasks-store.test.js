import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTaskStore } from "../src/tasks.js";
import { safeFileName } from "../src/util.js";

// 按真实执行流程：saveOutput(id, buffer, ext) 把输出写到 outputs/<id>.<ext>，
// 重启 load 时若 task 未存 file，会按 task id 找回 <id>.mp4 并置为 completed。
test("createTaskStore 持久化任务与输出文件，重启可恢复，cleanup 按 maxTasks 淘汰旧终态任务并删盘", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "intx-gw-tasks-"));
  try {
    const store = createTaskStore({ dataDir: dir });
    const t1 = store.create({ id: "task_1", model: "video-test", request: { prompt: "a" } });
    const t2 = store.create({ id: "task_2", model: "video-test", request: { prompt: "b" } });

    const saved1 = await store.saveOutput(t1.id, Buffer.from("video-1"), "mp4");
    const saved2 = await store.saveOutput(t2.id, Buffer.from("video-2"), "mp4");
    assert.equal(saved1.file, path.join(dir, "outputs", "task_1.mp4"));
    assert.equal(saved2.file, path.join(dir, "outputs", "task_2.mp4"));

    await store.persistNow({ required: true });

    // 重启：从 tasks.json 恢复任务，并按 id 找回输出文件、置为 completed
    const reloaded = createTaskStore({ dataDir: dir });
    await reloaded.load();
    assert.equal(reloaded.get("task_1")?.status, "completed");
    assert.equal(reloaded.get("task_2")?.status, "completed");
    assert.equal(reloaded.contentPath("task_1"), saved1.file);
    assert.equal(reloaded.contentPath("task_2"), saved2.file);

    // cleanup 按 maxTasks=1 淘汰最旧的终态任务并删除其输出文件
    const cleaned = await reloaded.cleanup({ maxTasks: 1 });
    assert.equal(cleaned.removed, 1);
    assert.equal(cleaned.filesDeleted, 1);
    assert.equal(reloaded.get("task_1"), null);
    assert.ok(reloaded.get("task_2"));
    await assert.rejects(() => fsp.access(saved1.file));
    await fsp.access(saved2.file);

    const reloaded2 = createTaskStore({ dataDir: dir });
    await reloaded2.load();
    assert.equal(reloaded2.get("task_1"), null);
    assert.equal(reloaded2.get("task_2")?.status, "completed");
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("saveOutput 净化文件名，输出始终落在 outputs 目录内，contentPath 拒绝越界路径", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "intx-gw-sec-"));
  try {
    const store = createTaskStore({ dataDir: dir });
    const task = store.create({ id: "task_sec", model: "video-test", request: { prompt: "s" } });
    // 未完成任务没有输出文件，contentPath 返回 null
    assert.equal(store.contentPath(task.id), null);

    // 恶意文件名经 safeFileName 净化后不含路径分隔符
    const cleaned = safeFileName("../../etc/passwd.mp4");
    assert.ok(!cleaned.includes("/") && !cleaned.includes("\\"));
    assert.ok(!cleaned.includes(".."));

    const saved = await store.saveOutput(task.id, Buffer.from("ok"), "../../etc/passwd.mp4");
    const root = path.join(dir, "outputs");
    assert.equal(path.dirname(saved.file), root);
    assert.equal(path.basename(saved.file), `${task.id}.passwd.mp4`);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
