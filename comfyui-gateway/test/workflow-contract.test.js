import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyBindings, buildContext } from "../src/bindings.js";
import { createRegistry, inferBindings } from "../src/registry.js";
import { runImage } from "../src/runner.js";
import { validateWorkflowContract, workflowContract } from "../src/workflow-contract.js";

const graph = () => ({
  "1": { class_type: "CLIPTextEncode", inputs: { text: "original" } },
  "2": { class_type: "EmptyLatentImage", inputs: { width: ["5", 0], height: 512, batch_size: 1 } },
  "3": { class_type: "KSampler", inputs: { seed: 42, steps: 8 } },
  "4": { class_type: "SaveImage", inputs: { images: ["3", 0] } },
  "5": { class_type: "ResolutionSelector", inputs: { multiple: 16 } },
});
const entryFor = (workflow) => ({ name: "test", workflow, inputContract: true, outputNodes: ["4"], bindings: inferBindings(workflow) });

test("未修改的参数和连线不被画布默认值覆盖，明确修改的参数才注入", () => {
  const workflow = graph();
  const entry = entryFor(workflow);
  const context = buildContext({ prompt: "new", size: "1024x1024", count: 3, workflowValues: { steps: 12 } });
  const bound = applyBindings(workflow, entry, context);
  assert.equal(bound["1"].inputs.text, "new");
  assert.deepEqual(bound["2"].inputs.width, ["5", 0]);
  assert.equal(bound["2"].inputs.batch_size, 1);
  assert.equal(bound["3"].inputs.seed, 42);
  assert.equal(bound["3"].inputs.steps, 12);
  assert.equal(workflow["1"].inputs.text, "original");
  assert.equal(workflow["3"].inputs.steps, 8);
});

test("首尾帧输入注入 LoadImage 连线，绝不直接写文件名", () => {
  const workflow = { "1": { class_type: "WanFirstLastFrame", inputs: { first_frame: ["2", 0], last_frame: ["2", 0] } }, "2": { class_type: "LoadImage", inputs: { image: "old.png" } } };
  const bindings = inferBindings(workflow);
  const bound = applyBindings(workflow, { bindings, inputContract: true }, buildContext({ uploadedImages: [{ name: "first.png" }, { name: "last.png" }] }));
  assert.ok(bindings.image.asLink);
  assert.ok(bindings.image2.asLink);
  assert.equal(bound[bound["1"].inputs.first_frame[0]].inputs.image, "first.png");
  assert.equal(bound[bound["1"].inputs.last_frame[0]].inputs.image, "last.png");
});

test("只传参考图时清掉原图中的参考视频连线，保留其他输入和原工作流", () => {
  const workflow = {
    "265": { class_type: "MiniMaxH3ReferenceToVideo", inputs: {
      prompt: "original", "ref_images.ref_image_0": ["2", 0], "ref_videos.ref_video_0": ["3", 0], vae: ["4", 0],
    } },
    "2": { class_type: "LoadImage", inputs: { image: "sample.png" } },
    "3": { class_type: "VHS_LoadVideo", inputs: { video: "sample.mp4" } },
    "4": { class_type: "VAELoader", inputs: { vae_name: "vae.safetensors" } },
  };
  const entry = entryFor(workflow);
  const bound = applyBindings(workflow, entry, buildContext({ uploadedImages: [{ name: "canvas.png" }] }));
  const inputs = bound["265"].inputs;
  assert.equal(bound[inputs["ref_images.ref_image_0"][0]].inputs.image, "canvas.png");
  assert.equal(Object.hasOwn(inputs, "ref_videos.ref_video_0"), false);
  assert.deepEqual(inputs.vae, ["4", 0]);
  assert.deepEqual(workflow["265"].inputs["ref_videos.ref_video_0"], ["3", 0]);
});

test("无效声明被拒绝；字段声明保留尺寸类型", () => {
  const entry = entryFor(graph());
  assert.throws(() => validateWorkflowContract(entry.workflow, entry.bindings, []), /输出/);
  assert.throws(() => validateWorkflowContract(entry.workflow, { prompt: { node: "missing", input: "text" } }, ["4"]), /绑定/);
  assert.equal(workflowContract(entry).fields.find((field) => field.key === "width").type, "number");
});

test("导入为草稿；无效发布不写注册表，空绑定不会被重新推断", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "intx-contract-"));
  try {
    const registry = createRegistry({ dir });
    await registry.load();
    const result = await registry.importWorkflow({ json: graph(), name: "test", draft: true });
    const id = result.workflow.id;
    assert.equal(registry.resolve(id).draft, true);
    const before = await readFile(registry.registryPath, "utf8");
    await assert.rejects(registry.updateWorkflow(id, { inputContract: true, outputNodes: [] }));
    assert.equal(await readFile(registry.registryPath, "utf8"), before);
    await registry.updateWorkflow(id, { inputContract: true, outputNodes: ["4"], bindings: {} });
    assert.equal(registry.resolve(id).draft, false);
    assert.deepEqual(registry.resolve(id).bindings, {});
    assert.deepEqual(registry.resolve(id).workflow, graph());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("只执行一次，只下载选定节点的输出", async () => {
  let submissions = 0;
  const downloads = [];
  const comfy = {
    submit: async () => { submissions++; return { promptId: "original-task" }; },
    history: async () => ({ status: { completed: true }, outputs: { "4": { images: [{ filename: "chosen.png", type: "output" }] }, "9": { images: [{ filename: "other.png", type: "output" }] } } }),
    view: async (file) => { downloads.push(file.filename); return { buffer: Buffer.from("image"), contentType: "image/png" }; },
  };
  const result = await runImage({ entry: entryFor(graph()), context: buildContext({ prompt: "new", count: 3 }), comfy });
  assert.equal(submissions, 1);
  assert.deepEqual(downloads, ["chosen.png"]);
  assert.equal(result.promptId, "original-task");
});

test("执行失败不自动重发工作流", async () => {
  let submissions = 0;
  const comfy = {
    submit: async () => { submissions++; return { promptId: "failed-task" }; },
    history: async () => ({ status: { status_str: "error", messages: ["CUDA out of memory"] } }),
  };
  await assert.rejects(runImage({ entry: entryFor(graph()), context: buildContext({ prompt: "new" }), comfy }), /out of memory/);
  assert.equal(submissions, 1);
});
