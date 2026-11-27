import test from "node:test";
import assert from "node:assert/strict";

import { workflowContract, validateWorkflowContract } from "../src/workflow-contract.js";
import { workflowAvailabilityProblem } from "../src/workflow-availability.js";
import { estimateStepPlan } from "../src/step-plan.js";
import { resolveVariantFallback } from "../src/variant-fallback.js";

test("workflowContract returns undefined without inputContract", () => {
  assert.equal(workflowContract({ id: "wf-1", workflow: {} }), undefined);
});

test("workflowContract maps frameRole, media types, defaults, and asyncImages", () => {
  const entry = {
    id: "wf-img",
    type: "image",
    inputContract: true,
    outputNodes: ["9"],
    workflow: {
      "1": { inputs: { text: "default prompt", steps: 20, seed: 42, enabled: true } },
      "2": { inputs: { start_image: "a.png", end_frame: "b.png" } },
      "3": { inputs: { refs: [] } },
    },
    bindings: {
      prompt: { node: "1", input: "text", required: true },
      steps: { node: "1", input: "steps", min: 1, max: 50 },
      enabled: { node: "1", input: "enabled" },
      first: { node: "2", input: "start_image", from: "image", imageIndex: 0 },
      last: { node: "2", input: "end_frame", from: "image", imageIndex: 1 },
      videos: { node: "3", input: "refs", array: true, loadType: "video" },
    },
  };

  const contract = workflowContract(entry);
  assert.equal(contract.asyncImages, true);
  assert.deepEqual(contract.outputNodes, ["9"]);

  const byKey = Object.fromEntries(contract.fields.map((f) => [f.key, f]));
  assert.equal(byKey.prompt.default, undefined);
  assert.equal(byKey.prompt.required, true);
  assert.equal(byKey.steps.type, "number");
  assert.equal(byKey.steps.default, 20);
  assert.equal(byKey.enabled.type, "boolean");
  assert.equal(byKey.enabled.default, true);
  assert.equal(byKey.first.frameRole, "firstFrame");
  assert.equal(byKey.first.media, "image");
  assert.equal(byKey.last.frameRole, "lastFrame");
  assert.equal(byKey.videos.media, "video");
  assert.equal(byKey.videos.array, true);
});

test("validateWorkflowContract rejects missing outputs, invalid bindings, and unlinked image arrays", () => {
  const workflow = {
    "1": { inputs: { prompt: "hi", image: ["2", 0] } },
    "9": { inputs: {} },
  };

  assert.throws(() => validateWorkflowContract(workflow, {}, []), /至少一个结果输出节点/);
  assert.throws(() => validateWorkflowContract(workflow, {}, ["404"]), /输出节点 404 不存在/);
  assert.throws(
    () => validateWorkflowContract(workflow, { bad: { node: "1", input: "missing" } }, ["9"]),
    /有效的节点和输入/,
  );
  assert.throws(
    () => validateWorkflowContract(workflow, { img: { node: "1", input: "image", from: "image" } }, ["9"]),
    /图片节点连线/,
  );

  // Valid when asLink: true
  assert.doesNotThrow(() =>
    validateWorkflowContract(workflow, { img: { node: "1", input: "image", from: "image", asLink: true } }, ["9"]),
  );
});

test("workflowAvailabilityProblem handles checking, unavailable, mode-unavailable, and bypass", () => {
  const entry = { id: "wan22", name: "Wan 2.2" };

  assert.equal(workflowAvailabilityProblem(null, entry), null);
  assert.equal(
    workflowAvailabilityProblem(
      { workflowStatus: () => ({ available: false }) },
      entry,
      { allowUnavailable: true },
    ),
    null,
  );

  const checking = workflowAvailabilityProblem(
    { workflowStatus: () => ({ checking: true, problems: [{ message: "扫描模型中" }] }) },
    entry,
  );
  assert.equal(checking.code, "workflow_checking");
  assert.match(checking.message, /Wan 2\.2/);

  const unavailable = workflowAvailabilityProblem(
    { workflowStatus: () => ({ available: false, problems: [{ message: "缺少主模型" }] }) },
    entry,
  );
  assert.equal(unavailable.code, "workflow_unavailable");
  assert.match(unavailable.message, /缺少主模型/);

  const modeUnavailable = workflowAvailabilityProblem(
    {
      workflowStatus: () => ({
        available: true,
        variants: { edit: { available: false, problems: [{ message: "缺少编辑 LoRA" }] } },
      }),
    },
    entry,
    { mode: "edit" },
  );
  assert.equal(modeUnavailable.code, "workflow_mode_unavailable");
  assert.equal(modeUnavailable.details.mode, "edit");

  assert.equal(
    workflowAvailabilityProblem(
      { workflowStatus: () => ({ available: true, variants: { edit: { available: true } } }) },
      entry,
      { mode: "edit" },
    ),
    null,
  );
});

test("estimateStepPlan aggregates KSampler, KSamplerAdvanced, SamplerCustomAdvanced, and SelfLift", () => {
  const workflow = {
    "1": { class_type: "KSampler", inputs: { steps: 12 } },
    "2": { class_type: "KSamplerAdvanced", inputs: { steps: 20, start_at_step: 5, end_at_step: 15 } },
    "3": { class_type: "ManualSigmas", inputs: { sigmas: "1.0, 0.7, 0.4, 0.1, 0.0" } },
    "4": { class_type: "H3SigmaRefiner", inputs: { sigmas: ["3", 0], extra_steps: 2 } },
    "5": { class_type: "SamplerCustomAdvanced", inputs: { sigmas: ["4", 0] } },
    "6": { class_type: "BasicScheduler", inputs: { steps: 8 } },
    "7": { class_type: "SelfLiftH3Sampler", inputs: { sigmas: ["6", 0] } },
  };

  const plan = estimateStepPlan(workflow);
  assert.equal(plan.steps["1"], 12);
  assert.equal(plan.steps["2"], 10);
  assert.equal(plan.steps["5"], 6); // 4 intervals from 5 sigmas + 2 extra_steps
  assert.equal(plan.steps["7"], 8);
  assert.equal(plan.absolute["7"], true);
  assert.equal(plan.total, 36);
});

test("resolveVariantFallback downgrades video-h3-viggle-swap edit mode only when needed and available", () => {
  const entry = {
    id: "video-h3-viggle-swap",
    variants: { edit: {}, "edit-singularity": {} },
  };

  // Primary unavailable, fallback available -> downgrade
  assert.equal(
    resolveVariantFallback(
      { workflowStatus: () => ({ variants: { edit: { available: false }, "edit-singularity": { available: true } } }) },
      entry,
      "edit",
    ),
    "edit-singularity",
  );

  // Primary available -> keep edit
  assert.equal(
    resolveVariantFallback(
      { workflowStatus: () => ({ variants: { edit: { available: true }, "edit-singularity": { available: true } } }) },
      entry,
      "edit",
    ),
    "edit",
  );

  // Fallback also unavailable -> keep edit
  assert.equal(
    resolveVariantFallback(
      { workflowStatus: () => ({ variants: { edit: { available: false }, "edit-singularity": { available: false } } }) },
      entry,
      "edit",
    ),
    "edit",
  );
});
