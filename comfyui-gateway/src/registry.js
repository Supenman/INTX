import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { validateWorkflowContract } from "./workflow-contract.js";

import { deepClone, isPlainObject, nowIso, readJsonFile, slugify, truncate, writeJsonAtomic } from "./util.js";
import { baseModelDefault, decorateEntry, findUnetLoader, listBaseModels, listModelDescriptors, resolveBaseModelFile, resolveBaseModelVariant } from "./base-models.js";

const REGISTRY_FILE = "registry.json";
const TYPE_PREFIX = { image: "image", video: "video", audio: "audio", text: "text" };

export class RegistryError extends Error {
  constructor(message, { status = 400, code = "registry_error", details } = {}) {
    super(message);
    this.name = "RegistryError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiWorkflow(value) {
  if (!isPlainObject(value)) return false;
  const entries = Object.entries(value);
  if (!entries.length) return false;
  return entries.every(([, node]) => isPlainObject(node) && typeof node.class_type === "string" && isPlainObject(node.inputs));
}

export function isUiWorkflow(value) {
  return isPlainObject(value) && Array.isArray(value.nodes) && Array.isArray(value.links);
}

export function inferType(workflow, hint) {
  if (["image", "video", "audio", "text"].includes(hint)) return hint;
  const classes = Object.values(workflow || {}).map((node) => String(node?.class_type || ""));
  const joined = classes.join(" ");
  if (/SaveVideo|VHS_VideoCombine|SaveWebM|WanImageToVideo|WanFirstLastFrame|WanVace|MiniMaxH3|MinimaxH3|H3.*(?:Video|Ref)|VDN-H3/i.test(joined)) return "video";
  if (/SaveImage|KSampler|Empty.*LatentImage/i.test(joined)) return "image";
  if (/SaveAudio|VAE.*Audio|Audio/i.test(joined)) return "audio";
  return "text";
}

function ensureTypePrefix(name, type) {
  const prefix = TYPE_PREFIX[type] || "text";
  const value = String(name || "workflow").trim() || "workflow";
  return value.toLowerCase().startsWith(`${prefix}-`) ? value : `${prefix}-${value}`;
}

function findNodes(workflow) {
  return Object.entries(workflow).map(([id, node]) => ({ id, classType: node.class_type, inputs: node.inputs, meta: node._meta || {} }));
}

function firstNode(nodes, pattern) {
  return nodes.find((node) => pattern.test(node.classType));
}

/** 输入是 [节点id, 输出索引] 形式的连线时，返回上游节点，否则 null。 */
function linkedNode(nodes, value) {
  if (!Array.isArray(value) || typeof value[0] !== "string") return null;
  return nodes.find((node) => node.id === value[0]) || null;
}

/**
 * 解析文本输入的可写目标。ComfyUI 常见写法有两种：
 *   1) CLIPTextEncode.text 直接是字符串 → 直接绑定它
 *   2) text 连到 PrimitiveStringMultiline（标题常含 User Prompt）→ 绑定该节点的 value
 * 返回 { node, input } 或 null。
 */
function resolveTextBinding(nodes, textNode, inputName) {
  const value = textNode.inputs?.[inputName];
  if (typeof value === "string") return { node: textNode.id, input: inputName };
  const upstream = linkedNode(nodes, value);
  if (upstream && /PrimitiveString/i.test(upstream.classType)) {
    const target = "value" in (upstream.inputs || {}) ? "value" : "text";
    return { node: upstream.id, input: target };
  }
  return null;
}

/** 视频生成节点家族：承载 prompt/尺寸/帧数/参考素材的条件节点。 */
const VIDEO_CLASS_PATTERN = /MiniMaxH3|MinimaxH3|PH3Image|HyperFlow|WanImageToVideo|WanFirstLastFrame|WanVace|HunyuanVideo|CogVideoX|LtxVideo|LTXVideo|AnimateDiff|VDN-H3|VideoConditioning|ImageToVideo|h3-key-inputs|H3.*(?:Video|Conditioning|Sampler|Ref)/i;
/** H3 系：帧数需 17k+5 对齐、尺寸需 32 像素对齐、默认 24fps。 */
const H3_CLASS_PATTERN = /MiniMaxH3|MinimaxH3|PH3Image|HyperFlow|VDN-H3|h3-key-inputs|H3.*(?:Video|Conditioning|Ref|Sampler)/i;

/** 判断节点是否能作为视频参数载体（已知类名，或具备"帧数 + 尺寸/提示词/参考素材"特征）。 */
function isVideoCarrier(node) {
  const keys = Object.keys(node.inputs || {}).map((key) => key.toLowerCase());
  const hasFrames = keys.some((key) => ["length", "num_frames", "frames", "video_frames", "duration"].includes(key));
  const hasMedia = keys.some((key) => /ref_image|ref_video|ref_audio|first_frame|last_frame|start_image|end_image|picture/.test(key));
  const hasSize = keys.includes("width") && keys.includes("height");
  const hasPrompt = keys.includes("prompt");
  return VIDEO_CLASS_PATTERN.test(node.classType || "") || (hasFrames && (hasSize || hasPrompt || hasMedia));
}

/** 从输入名里识别 "前缀+序号" 的参考素材组，如 ref_images.ref_image_0、picture_1。 */
function mediaArraySpecs(carriers) {
  const specs = [];
  const seen = new Set();
  for (const node of carriers) {
    for (const input of Object.keys(node.inputs || {})) {
      const match = input.match(/^(.*?)(\d+)$/);
      if (!match) continue;
      const prefix = match[1];
      if (seen.has(prefix) || !/(image|picture|video|audio|frame|ref)/i.test(prefix)) continue;
      const from = /video/i.test(prefix) ? (/audio/i.test(prefix) ? "audio" : "video") : /audio/i.test(prefix) ? "audio" : "image";
      seen.add(prefix);
      specs.push({ node, prefix, from, indexBase: Number(match[2]) });
    }
  }
  return specs;
}

/** 视频参数绑定：尺寸/帧数/fps/seed/steps/cfg/H3 高级参数/首尾帧/参考素材数组。 */
function inferVideoBindings(nodes, bindings) {
  const carriers = nodes.filter(isVideoCarrier);
  if (!carriers.length) return;
  const main = carriers.find((node) => /ref_image|first_frame|start_image/i.test(Object.keys(node.inputs || {}).join(" ").toLowerCase())) || carriers[0];
  const isH3 = H3_CLASS_PATTERN.test(main.classType || "");
  const fpsValue = Number(main.inputs?.fps ?? main.inputs?.frame_rate);
  const fps = Number.isFinite(fpsValue) && fpsValue > 0 ? fpsValue : isH3 ? 24 : 16;

  for (const input of Object.keys(main.inputs || {})) {
    const low = input.toLowerCase();
    const fallback = Number.isFinite(main.inputs[input]) ? main.inputs[input] : undefined;
    if (low === "width" || low === "height") {
      bindings[low] = { node: main.id, input, from: `size.${low}`, default: fallback, ...(isH3 ? { transform: "snap32" } : {}) };
    } else if (["length", "num_frames", "frames", "video_frames"].includes(low)) {
      bindings.length = { node: main.id, input, from: "seconds", transform: isH3 ? "secondsToFrames17" : "secondsToFrames", fps, default: fallback };
    } else if (low === "duration" && !bindings.length) {
      bindings.length = { node: main.id, input, from: "seconds", default: fallback };
    } else if (low === "fps" || low === "frame_rate") {
      bindings.fps = { node: main.id, input, default: fallback ?? fps };
    } else if (low === "prompt" && !bindings.prompt) {
      bindings.prompt = resolveTextBinding(nodes, main, "prompt") || { node: main.id, input };
    }
  }

  // 采样器参数可能在独立 sampler / sigma 节点上（SelfLiftH3Sampler、HyperFlowSigmas 等）。
  const h3Tuning = ["transition_step", "lowres_scale", "rho", "w_min", "w_max"];
  for (const node of nodes) {
    if (!/Sampler|Sigmas|Noise|KSampler/i.test(node.classType || "")) continue;
    for (const input of Object.keys(node.inputs || {})) {
      const low = input.toLowerCase();
      const fallback = Number.isFinite(node.inputs[input]) ? node.inputs[input] : undefined;
      if ((low === "seed" || low === "noise_seed") && !bindings.seed) {
        bindings.seed = { node: node.id, input, from: "params.seed", random: true, default: fallback };
      } else if (low === "steps" && !bindings.steps) {
        bindings.steps = { node: node.id, input, from: "params.steps", default: fallback };
      } else if (low === "cfg" && !bindings.cfg) {
        bindings.cfg = { node: node.id, input, from: "params.cfg", default: fallback };
      } else if (h3Tuning.includes(low)) {
        bindings[low] = { node: node.id, input, from: `params.${low}`, default: fallback };
      }
    }
  }

  // 首尾帧：第一张参考图→first，第二张→last；覆盖普通 LoadImage 绑定。
  for (const node of carriers) {
    for (const input of Object.keys(node.inputs || {})) {
      const low = input.toLowerCase();
      if (["first_frame", "start_image", "start_frame"].includes(low)) bindings.image = { node: node.id, input, from: "image", imageIndex: 0, asLink: true };
      else if (["last_frame", "end_image", "end_frame"].includes(low)) bindings.image2 = { node: node.id, input, from: "image", imageIndex: 1, asLink: true };
    }
  }

  // 参考素材数组：ref_images / ref_videos / ref_audios / picture_N 等。
  for (const spec of mediaArraySpecs(carriers)) {
    const sampleCount = carriers.reduce((count, node) => count + Object.keys(node.inputs || {}).filter((key) => key.startsWith(spec.prefix)).length, 0);
    const firstInput = Object.keys(spec.node.inputs || {}).find((key) => key.startsWith(spec.prefix));
    if (!firstInput) continue;
    const key = spec.from === "image" ? "refs" : spec.from === "video" ? "videos" : "audios";
    bindings[key] = {
      node: spec.node.id,
      input: firstInput,
      from: spec.from,
      array: true,
      loadType: spec.from,
      inputPrefix: spec.prefix,
      indexBase: spec.indexBase,
      min: 0,
      max: Math.max(1, sampleCount),
    };
  }
}

export function inferBindings(workflow) {
  const nodes = findNodes(workflow);
  const bindings = {};
  const textNodes = nodes.filter((node) => /CLIPTextEncode/i.test(node.classType));
  if (textNodes.length) {
    const positive = textNodes.find((node) => /positive|正向|正面/i.test(String(node.meta.title || ""))) || textNodes[0];
    const negative = textNodes.find((node) => /negative|负向|负面/i.test(String(node.meta.title || ""))) || textNodes.find((node) => node.id !== positive.id);
    const prompt = resolveTextBinding(nodes, positive, "text") || resolveTextBinding(nodes, positive, "text_g");
    if (prompt) {
      bindings.prompt = prompt;
      // text_g 双通道模型（如 SD3）还要同步 text_l
      if (prompt.input === "text_g") bindings.prompt2 = { node: prompt.node, input: "text_l", from: "prompt" };
    }
    if (negative) {
      const neg = resolveTextBinding(nodes, negative, "text") || resolveTextBinding(nodes, negative, "text_g");
      if (neg) {
        bindings.negative = { ...neg, default: "" };
        if (neg.input === "text_g") bindings.negative2 = { node: neg.node, input: "text_l", default: "" };
      }
    }
  }

  const latent = firstNode(nodes, /Empty.*LatentImage/i);
  if (latent) {
    // 宽高可能是连线到 ResolutionSelector / 尺寸计算节点（由 aspect_ratio+megapixels 动态算出），
    // 此时直接绑定 latent 的 width/height，applyBindings 写入数字会覆盖连线，让画布尺寸生效。
    const sizeInput = (name, from) => {
      const value = latent.inputs?.[name];
      if (Number.isFinite(value)) return { node: latent.id, input: name, from, default: value };
      const upstream = linkedNode(nodes, value);
      if (upstream && /ResolutionSelector|Resolution|AspectRatio|ImageSize/i.test(upstream.classType)) {
        const binding = { node: latent.id, input: name, from };
        const multiple = Number(upstream.inputs?.multiple);
        if (multiple === 16) binding.transform = "snap16";
        else if (multiple === 32) binding.transform = "snap32";
        else if (Number.isFinite(multiple) && multiple > 1) binding.transform = "round";
        return binding;
      }
      return null;
    };
    const widthBinding = sizeInput("width", "size.width");
    if (widthBinding) bindings.width = widthBinding;
    const heightBinding = sizeInput("height", "size.height");
    if (heightBinding) bindings.height = heightBinding;
    if (Number.isFinite(latent.inputs.batch_size)) bindings.batch = { node: latent.id, input: "batch_size", from: "count", default: latent.inputs.batch_size };
  }

  const sampler = firstNode(nodes, /KSampler/i);
  if (sampler) {
    if (Number.isFinite(sampler.inputs.seed)) bindings.seed = { node: sampler.id, input: "seed", random: true };
    if (Number.isFinite(sampler.inputs.steps)) bindings.steps = { node: sampler.id, input: "steps", from: "quality.steps", default: sampler.inputs.steps };
    if (Number.isFinite(sampler.inputs.cfg)) bindings.cfg = { node: sampler.id, input: "cfg", from: "quality.cfg", default: sampler.inputs.cfg };
    if (Number.isFinite(sampler.inputs.denoise) && nodes.some((node) => /^LoadImage/i.test(node.classType))) {
      bindings.denoise = { node: sampler.id, input: "denoise", from: "params.denoise", default: sampler.inputs.denoise };
    }
  }
  const noise = firstNode(nodes, /RandomNoise/i);
  if (!bindings.seed && noise && "noise_seed" in (noise.inputs || {})) {
    bindings.seed = { node: noise.id, input: "noise_seed", random: true };
  }
  const basicScheduler = firstNode(nodes, /BasicScheduler/i);
  if (!bindings.steps && basicScheduler && Number.isFinite(basicScheduler.inputs.steps)) {
    bindings.steps = { node: basicScheduler.id, input: "steps", from: "quality.steps", default: basicScheduler.inputs.steps };
  }

  // 视频类参数（尺寸/帧数/fps/seed/steps/cfg/H3 高级参数/首尾帧/参考素材数组）
  inferVideoBindings(nodes, bindings);

  // LoadImage 兜底：视频工作流里 ref_images 数组已接管参考图，不要再绑原始 LoadImage，避免重复注入。
  if (!bindings.refs && !bindings.videos && !bindings.audios) {
    const loadImages = nodes.filter((node) => /^LoadImage/i.test(node.classType));
    if (loadImages[0] && !bindings.image) bindings.image = { node: loadImages[0].id, input: "image", from: "image", imageIndex: 0 };
    if (loadImages[1] && !bindings.image2) bindings.image2 = { node: loadImages[1].id, input: "image", from: "image", imageIndex: 1 };
  }

  if (!bindings.prompt) {
    for (const node of nodes) {
      for (const [input, value] of Object.entries(node.inputs || {})) {
        if (typeof value === "string" && /^(prompt|positive|text)$/i.test(input)) {
          bindings.prompt = { node: node.id, input };
          break;
        }
      }
      if (bindings.prompt) break;
    }
  }
  return bindings;
}

export function isKnownWorkflowOutput(classType) {
  return /SaveImage|SaveVideo|VHS_VideoCombine|SaveWebM/i.test(classType);
}

function outputWarnings(workflow) {
  const warnings = [];
  if (!Object.values(workflow || {}).some((node) => isKnownWorkflowOutput(node?.class_type))) {
    warnings.push("工作流里没有找到 SaveImage / SaveVideo / VHS_VideoCombine 输出节点，生成结果可能无法取回。");
  }
  return warnings;
}

function bindingWarnings(workflow, bindings) {
  const warnings = [];
  for (const [key, binding] of Object.entries(bindings || {})) {
    if (!binding || !binding.node || !binding.input) {
      warnings.push(`绑定 ${key} 缺少 node/input。`);
      continue;
    }
    const node = workflow[binding.node];
    if (!node) {
      warnings.push(`绑定 ${key} 指向不存在的节点 ${binding.node}。`);
      continue;
    }
    if (!(binding.input in (node.inputs || {}))) warnings.push(`绑定 ${key} 指向 ${binding.node}.${binding.input}，但该输入不存在。`);
  }
  return warnings;
}

export async function migrateUserWorkflows(legacyDir, dir, maxWorkflowBytes) {
  if (!legacyDir || path.resolve(legacyDir) === dir || fs.existsSync(path.join(dir, REGISTRY_FILE))) return;
  const legacyRegistry = path.join(legacyDir, REGISTRY_FILE);
  if (!fs.existsSync(legacyRegistry)) return;
  const data = await readJsonFile(legacyRegistry, maxWorkflowBytes);
  if (data.version !== 1 || !Array.isArray(data.workflows)) throw new Error("旧工作流注册表格式不受支持");
  const workflows = data.workflows.filter((entry) => {
    const source = entry.source;
    // 扫描旧网关目录所得的预设无需迁移。配置页导入使用 json 或 url。
    if (source?.kind === "json" || source?.kind === "url") return true;
    if (source?.kind !== "path" || typeof source.path !== "string") return false;
    const relative = path.relative(legacyDir, source.path);
    return path.isAbsolute(relative) || relative.startsWith(".." + path.sep);
  });
  await fsp.mkdir(dir, { recursive: true });
  for (const entry of workflows) {
    if (typeof entry.file !== "string" || !/^[^/\\]+\.json$/i.test(entry.file) || entry.file === REGISTRY_FILE) {
      throw new Error("旧工作流注册表包含无效的文件名");
    }
    const source = path.join(legacyDir, entry.file);
    const target = path.join(dir, entry.file);
    try {
      await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== "EEXIST" || !(await fsp.readFile(source)).equals(await fsp.readFile(target))) throw error;
    }
  }
  await writeJsonAtomic(path.join(dir, REGISTRY_FILE), { version: 1, workflows });
}

export function createRegistry({ dir, maxWorkflowBytes = 5 * 1024 * 1024, logger, mainModelFile = () => "" } = {}) {
  const registryPath = path.join(dir, REGISTRY_FILE);
  let cache = new Map();
  let byName = new Map();
  let signature = "";
  let loaded = false;
  let loading = null;
  let writes = Promise.resolve();

  function enqueueWrite(operation) {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  }

  async function ensureRegistryFile() {
    try {
      await fsp.access(registryPath);
    } catch {
      await writeJsonAtomic(registryPath, { version: 1, workflows: [] });
    }
  }

  async function readRegistryData() {
    await ensureRegistryFile();
    const data = await readJsonFile(registryPath, maxWorkflowBytes);
    return Array.isArray(data?.workflows) ? data.workflows : [];
  }

  async function computeSignature(entries) {
    const parts = [];
    try {
      const stat = await fsp.stat(registryPath);
      parts.push(`registry:${stat.mtimeMs}:${stat.size}`);
    } catch {
      parts.push("registry:missing");
    }
    for (const entry of entries) {
      const tierFiles = Object.values(entry.tiers || {}).flatMap((tier) => Object.values(tier?.files || {}));
      const files = [entry.file, ...Object.values(entry.variants || {}).map((variant) => variant?.file), ...tierFiles].filter(Boolean);
      for (const file of files) {
        const filePath = path.isAbsolute(file) ? file : path.join(dir, file);
        try {
          const stat = await fsp.stat(filePath);
          parts.push(`${filePath}:${stat.mtimeMs}:${stat.size}`);
        } catch {
          parts.push(`${filePath}:missing`);
        }
      }
    }
    return parts.join("|");
  }

  async function doLoad() {
    const entries = await readRegistryData();
    // 局部构建完成后一次交换，任何并发读取只能看到上一份或下一份完整注册表。
    const nextCache = new Map();
    const nextByName = new Map();
    for (const raw of entries) {
      try {
        if (!raw?.file) throw new Error("缺少 file 字段");
        const filePath = path.isAbsolute(raw.file) ? raw.file : path.join(dir, raw.file);
        const workflow = await readJsonFile(filePath, maxWorkflowBytes);
        if (!isApiWorkflow(workflow)) {
          if (isUiWorkflow(workflow)) logger?.warn?.(`跳过 UI 格式工作流 ${raw.file}，请在 ComfyUI 中导出 API 格式。`);
          else logger?.warn?.(`跳过无效工作流 ${raw.file}`);
          continue;
        }
        const type = inferType(workflow, raw.type);
        const id = raw.id || slugify(raw.name || path.basename(filePath, ".json"), `workflow-${Date.now()}`);
        const name = ensureTypePrefix(raw.name || id, type);
        const entry = {
          ...raw,
          id,
          name,
          type,
          file: raw.file,
          filePath,
          workflow,
          bindings: raw.inputContract ? raw.bindings || {} : raw.bindings && Object.keys(raw.bindings).length ? raw.bindings : inferBindings(workflow),
        };
        if (raw.variants) {
          entry.variants = {};
          for (const [mode, variant] of Object.entries(raw.variants)) {
            if (!variant?.file) continue;
            const variantPath = path.isAbsolute(variant.file) ? variant.file : path.join(dir, variant.file);
            const variantWorkflow = await readJsonFile(variantPath, maxWorkflowBytes);
            if (!isApiWorkflow(variantWorkflow)) {
              logger?.warn?.(`跳过无效变体 ${mode}: ${variant.file}`);
              continue;
            }
            entry.variants[mode] = { ...variant, filePath: variantPath, workflow: variantWorkflow, bindings: variant.bindings || entry.bindings, defaults: variant.defaults || entry.defaults };
          }
        }
        if (raw.tiers && typeof raw.tiers === "object") {
          entry.tiers = {};
          for (const [tierId, tier] of Object.entries(raw.tiers)) {
            if (!tier || typeof tier !== "object") continue;
            const loadedTier = { ...tier, workflows: {} };
            for (const [precision, file] of Object.entries(tier.files || {})) {
              if (!file) continue;
              const tierPath = path.isAbsolute(file) ? file : path.join(dir, file);
              try {
                const tierWorkflow = await readJsonFile(tierPath, maxWorkflowBytes);
                if (!isApiWorkflow(tierWorkflow)) throw new Error("不是 API 格式工作流");
                loadedTier.workflows[precision] = { file, filePath: tierPath, workflow: tierWorkflow, bindings: tier.bindings || entry.bindings, defaults: tier.defaults || entry.defaults };
              } catch (error) {
                logger?.warn?.(`加载 MOSS 档位失败 ${tierId}/${precision}: ${file}（${error.message}）`);
              }
            }
            entry.tiers[tierId] = loadedTier;
          }
        }
        nextCache.set(id, entry);
        nextByName.set(name, entry);
        if (id !== name) nextByName.set(id, entry);
      } catch (error) {
        logger?.warn?.(`加载工作流失败 ${raw?.file || raw?.id || "unknown"}: ${error.message}`);
      }
    }
    const nextSignature = await computeSignature(entries);
    cache = nextCache;
    byName = nextByName;
    signature = nextSignature;
    loaded = true;
  }

  async function load() {
    if (loading) return loading;
    loading = doLoad().finally(() => {
      loading = null;
    });
    return loading;
  }

  async function reloadIfChanged() {
    if (!loaded) {
      await load();
      return true;
    }
    try {
      const entries = await readRegistryData();
      const next = await computeSignature(entries);
      if (next === signature) return false;
      await load();
      return true;
    } catch (error) {
      logger?.warn?.(`registry reload check failed: ${error.message}`);
      return false;
    }
  }

  function publicEntry(entry) {
    if (!entry) return null;
    return {
      id: entry.id,
      name: entry.name,
      type: entry.type,
      label: entry.label || entry.name,
      description: entry.description || "",
      category: entry.category || null,
      hidden: entry.hidden === true,
      draft: entry.draft === true,
      inputContract: entry.inputContract === true,
      outputNodes: entry.outputNodes || [],
      file: entry.file,
      bindings: entry.bindings || {},
      defaults: entry.defaults || {},
      presets: entry.presets || {},
      parameters: Array.isArray(entry.parameters) ? entry.parameters : [],
      resolutionTiers: entry.resolutionTiers || null,
      defaultTier: entry.defaultTier || null,
      baseModels: entry.baseModels || null,
      lora: entry.lora || null,
      variantModes: entry.variants ? Object.keys(entry.variants) : [],
      variantLabels: entry.variantLabels || {},
      tiers: entry.tiers
        ? Object.fromEntries(
            Object.entries(entry.tiers).map(([tierId, tier]) => [
              tierId,
              { label: tier.label || tierId, steps: tier.steps ?? null, files: tier.files || {}, requires: tier.requires || null, unavailableReason: tier.unavailableReason || null },
            ]),
          )
        : null,
      importedAt: entry.importedAt,
      source: entry.source,
    };
  }

  function list() {
    return [...cache.values()].map(publicEntry).sort((a, b) => a.name.localeCompare(b.name));
  }

  function resolve(idOrName) {
    if (!idOrName) return null;
    return cache.get(idOrName) || byName.get(idOrName) || [...cache.values()].find((entry) => entry.name.toLowerCase() === String(idOrName).toLowerCase()) || null;
  }

  function decorateWithMainModel(entry, variant, loaderOptions) {
    const decorated = decorateEntry(entry, variant, loaderOptions);
    if (variant) return decorated;
    const file = mainModelFile(entry.id);
    if (!file) return decorated;
    const target = findUnetLoader(entry.workflow);
    if (!target) return decorated;
    const files = loaderOptions?.["UNETLoader"] || [];
    if (!files.includes(file)) return decorated;
    const bindingKey = Object.entries(entry.bindings || {}).find(([, binding]) => binding?.node === target.nodeId && binding?.input === target.input)?.[0];
    if (bindingKey) {
      return { ...decorated, baseModelParams: { ...(decorated.baseModelParams || {}), [bindingKey]: file } };
    }
    return { ...decorated, mainModelFile: file };
  }

  function listModels(loaderOptions = {}) {
    const entries = [...cache.values()];
    const descriptors = [];
    for (const descriptor of listModelDescriptors(entries, loaderOptions)) {
      const file = mainModelFile(descriptor.entry.id);
      if (descriptor.variant && file && descriptor.variant.file === file) continue;
      descriptors.push({ ...descriptor, entry: decorateWithMainModel(descriptor.entry, descriptor.variant, loaderOptions) });
    }
    for (const entry of entries) {
      const file = mainModelFile(entry.id);
      if (!file || !findUnetLoader(entry.workflow)) continue;
      if (!(loaderOptions?.["UNETLoader"] || []).includes(file)) continue;
      if (descriptors.some((descriptor) => descriptor.baseId === entry.id && !descriptor.variant)) continue;
      descriptors.push({
        modelId: entry.name,
        baseId: entry.id,
        entry: decorateWithMainModel(entry, null, loaderOptions),
        variant: null,
        defaultFile: baseModelDefault(entry, entry.baseModels),
      });
    }
    return descriptors;
  }

  function resolveModel(idOrName, loaderOptions = {}) {
    const direct = resolve(idOrName);
    if (direct) {
      const override = mainModelFile(direct.id);
      if (override && (loaderOptions?.["UNETLoader"] || []).includes(override)) {
        return { entry: decorateWithMainModel(direct, null, loaderOptions), variant: null };
      }
      const config = direct.baseModels;
      const defaultFile = baseModelDefault(direct, config);
      const matchedDefault = config && defaultFile ? resolveBaseModelFile(config, loaderOptions, defaultFile) : "";
      if (config && defaultFile && !matchedDefault) {
        const variant = listBaseModels(direct, loaderOptions).find((item) => resolveBaseModelFile(config, loaderOptions, item.file));
        if (variant) return { entry: decorateEntry(direct, variant, loaderOptions), variant };
      }
      if (config && matchedDefault && matchedDefault !== defaultFile) {
        const variant = listBaseModels(direct, loaderOptions).find((item) => path.basename(item.file).toLowerCase() === path.basename(matchedDefault).toLowerCase());
        return { entry: decorateEntry(direct, variant || { file: matchedDefault, label: path.basename(matchedDefault), id: "" }, loaderOptions), variant: variant || null };
      }
      return { entry: decorateWithMainModel(direct, null, loaderOptions), variant: null };
    }
    for (const entry of cache.values()) {
      const variant = resolveBaseModelVariant(entry, idOrName, loaderOptions);
      if (!variant) continue;
      return { entry: decorateEntry(entry, variant, loaderOptions), variant };
    }
    return null;
  }

  function resolveForMode(entry, mode) {
    const variant = mode ? entry?.variants?.[mode] : null;
    if (!variant) return entry;
    return {
      ...entry,
      ...variant,
      workflow: variant.workflow || entry.workflow,
      bindings: variant.bindings || entry.bindings,
      defaults: variant.defaults || entry.defaults,
    };
  }

  function schema(entry) {
    const fields = Object.entries(entry.bindings || {}).map(([key, binding]) => ({
      key,
      node: binding.node,
      input: binding.input,
      from: binding.from,
      default: binding.default,
      required: binding.required === true || key === "prompt",
      random: binding.random === true,
      transform: binding.transform,
      imageIndex: binding.imageIndex,
    }));
    return {
      id: entry.id,
      name: entry.name,
      type: entry.type,
      label: entry.label || entry.name,
      baseModel: entry.baseModel || null,
      baseModelLabel: entry.baseModelLabel || null,
      baseModels: entry.baseModels || null,
      variantModes: entry.variants ? Object.keys(entry.variants) : [],
      variantLabels: entry.variantLabels || {},
      fields,
      parameters: Array.isArray(entry.parameters) ? entry.parameters : [],
      lora: entry.lora || null,
    };
  }

  async function uniqueName(baseName) {
    let name = baseName;
    let index = 1;
    while (byName.has(name)) {
      index += 1;
      name = `${baseName}-${index}`;
    }
    return name;
  }

  async function importWorkflow({ url, path: sourcePath, json, name, type, bindings: overrideBindings, defaults, presets, parameters, lora, description, overwrite = false, draft = false } = {}) {
    let workflow;
    let derivedName = "";
    let source = {};
    if (json !== undefined) {
      if (typeof json === "string") {
        try {
          workflow = JSON.parse(json);
        } catch (error) {
          throw new RegistryError(`JSON 解析失败：${error.message}`, { code: "invalid_json" });
        }
      } else {
        workflow = json;
      }
      derivedName = name || "workflow";
      source = { kind: "json" };
    } else if (sourcePath) {
      const absolute = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(dir, sourcePath);
      const text = await fsp.readFile(absolute, "utf8");
      if (Buffer.byteLength(text) > maxWorkflowBytes) throw new RegistryError("工作流文件过大", { status: 413, code: "workflow_too_large" });
      try {
        workflow = JSON.parse(text);
      } catch (error) {
        throw new RegistryError(`工作流 JSON 解析失败：${error.message}`, { code: "invalid_json" });
      }
      derivedName = name || path.basename(absolute, ".json");
      source = { kind: "path", path: absolute };
    } else if (url) {
      if (!/^https?:\/\//i.test(url)) throw new RegistryError("只支持 http/https URL", { code: "invalid_url" });
      let response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "follow" });
      } catch (error) {
        throw new RegistryError(`下载工作流失败：${error.message}`, { status: 400, code: "download_failed" });
      }
      if (!response.ok) throw new RegistryError(`下载工作流失败：HTTP ${response.status}`, { status: 400, code: "download_failed" });
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength && contentLength > maxWorkflowBytes) throw new RegistryError("工作流文件过大", { status: 413, code: "workflow_too_large" });
      const text = await response.text();
      if (Buffer.byteLength(text) > maxWorkflowBytes) throw new RegistryError("工作流文件过大", { status: 413, code: "workflow_too_large" });
      try {
        workflow = JSON.parse(text);
      } catch (error) {
        throw new RegistryError(`工作流 JSON 解析失败：${error.message}`, { code: "invalid_json" });
      }
      try {
        derivedName = name || decodeURIComponent(new URL(url).pathname.split("/").pop() || "workflow").replace(/\.json$/i, "");
      } catch {
        derivedName = name || "workflow";
      }
      source = { kind: "url", url };
    } else {
      throw new RegistryError("请提供 url、path 或 json 之一", { code: "missing_source" });
    }

    if (isUiWorkflow(workflow)) {
      throw new RegistryError("这是 ComfyUI UI 格式工作流，不能直接提交。请在 ComfyUI 里使用「导出（API）」保存为 API 格式后再导入。", {
        status: 422,
        code: "ui_workflow_not_supported",
      });
    }
    if (!isApiWorkflow(workflow)) {
      throw new RegistryError("不是有效的 ComfyUI API 格式工作流（顶层节点需要 class_type + inputs）。", { status: 422, code: "invalid_api_workflow" });
    }

    const resolvedType = inferType(workflow, type);
    const desiredName = ensureTypePrefix(String(name || derivedName || "workflow").trim(), resolvedType);
    let finalName = desiredName;
    let existing = byName.get(finalName);
    let id;
    let fileName;
    if (existing && overwrite) {
      id = existing.id;
      fileName = existing.file;
      finalName = existing.name;
    } else {
      finalName = await uniqueName(desiredName);
      // slugify 只保留 a-z0-9，纯中文名会被清成类型前缀（如 "image"），
      // 导致多个中文工作流 id 撞车。清成前缀时改用类型 + 时间戳保证唯一。
      const slugBase = slugify(finalName, "");
      const makeId = () => (slugBase && slugBase !== resolvedType ? slugBase : `${resolvedType}-${Date.now().toString(36)}`);
      id = makeId();
      let suffix = 1;
      while (cache.has(id)) {
        suffix += 1;
        id = `${makeId()}-${suffix}`;
      }
      fileName = `${id}.json`;
    }

    const inferred = inferBindings(workflow);
    const mergedBindings = { ...inferred, ...(overrideBindings || {}) };
    const warnings = [...outputWarnings(workflow), ...bindingWarnings(workflow, mergedBindings)];
    if (!mergedBindings.prompt) warnings.push("没有自动推断到提示词绑定，请在输入绑定编辑器中确认。");

    await writeJsonAtomic(path.join(dir, fileName), workflow);
    const entry = {
      id,
      name: finalName,
      type: resolvedType,
      description: description || "",
      file: fileName,
      bindings: mergedBindings,
      ...(draft ? { draft: true, inputContract: true, outputNodes: [] } : {}),
      defaults: isPlainObject(defaults) ? defaults : {},
      presets: isPlainObject(presets) ? presets : {},
      parameters: Array.isArray(parameters) ? parameters : [],
      lora: isPlainObject(lora) ? lora : null,
      importedAt: nowIso(),
      source,
    };
    const data = await readRegistryData();
    const next = data.filter((item) => item.id !== id);
    next.push(entry);
    await writeJsonAtomic(registryPath, { version: 1, workflows: next });
    await load();
    const saved = resolve(id);
    return { workflow: publicEntry(saved), warnings };
  }

  async function scan() {
    const entries = await readRegistryData();
    const usedFiles = new Set(entries.flatMap((entry) => [entry.file, ...Object.values(entry.variants || {}).map((variant) => variant?.file)]).filter(Boolean));
    // 入口文件被导入后会复制成 registry 里的 file；源路径也必须去重，否则持续扫描会生成 -2/-3 副本。
    const usedSources = new Set(
      entries
        .flatMap((entry) => [entry.source?.path, ...Object.values(entry.variants || {}).map((variant) => variant?.source?.path)])
        .filter(Boolean)
        .map((sourcePath) => path.resolve(dir, sourcePath)),
    );
    const files = (await fsp.readdir(dir)).filter((file) => file.toLowerCase().endsWith(".json") && file !== REGISTRY_FILE && !usedFiles.has(file));
    const summary = { added: [], skipped: [], failed: [] };
    // 内容与已登记工作流相同的未登记文件不再导入；否则会和按内容去重的清理互相抵消，每轮扫描都改写 registry.json。
    const knownContent = new Set([...cache.values()].map((entry) => JSON.stringify(entry.workflow)));
    for (const file of files) {
      const absolute = path.resolve(dir, file);
      if (usedSources.has(absolute)) continue;
      let contentKey = null;
      try {
        contentKey = JSON.stringify(JSON.parse((await fsp.readFile(absolute, "utf8")).replace(/^\uFEFF/, "")));
      } catch {
        contentKey = null;
      }
      if (contentKey && knownContent.has(contentKey)) {
        summary.skipped.push({ file, reason: "内容与已登记工作流相同" });
        continue;
      }
      try {
        const result = await importWorkflow({ path: absolute, overwrite: false });
        if (contentKey) knownContent.add(contentKey);
        summary.added.push(result.workflow.name);
      } catch (error) {
        if (error instanceof RegistryError && error.code === "ui_workflow_not_supported") summary.skipped.push({ file, reason: error.message });
        else summary.failed.push({ file, reason: error.message });
      }
    }
    return summary;
  }

  async function remove(id) {
    const data = await readRegistryData();
    const target = data.find((entry) => entry.id === id);
    const next = data.filter((entry) => entry.id !== id);
    if (next.length === data.length) return false;
    await writeJsonAtomic(registryPath, { version: 1, workflows: next });
    // 同时删除工作流文件，否则下一次 scan() 会把散落的 JSON 重新导入，
    // 表现为「删除后工作流又回来了」。只允许删注册表目录内的相对路径文件。
    if (target?.file && !path.isAbsolute(target.file) && !target.file.split(/[\\/]/).includes("..")) {
      await fsp.unlink(path.join(dir, target.file)).catch(() => {});
    }
    await load();
    return true;
  }

  // 更新用户导入工作流的元数据。只接受画布编辑需要的字段，
  // 工作流 JSON 本身不改写（改绑定只改注册表映射，不动 ComfyUI 图）。
  async function updateWorkflow(id, patch = {}) {
    const data = await readRegistryData();
    const index = data.findIndex((entry) => entry.id === id);
    if (index < 0) throw new RegistryError("工作流不存在", { status: 404, code: "workflow_not_found" });
    const current = data[index];
    if (current.hidden) throw new RegistryError("内置工作流不能编辑", { status: 400, code: "workflow_internal" });

    const next = { ...current };
    if (typeof patch.label === "string" && patch.label.trim()) next.label = patch.label.trim();
    if (typeof patch.description === "string") next.description = patch.description;
    if (isPlainObject(patch.bindings)) next.bindings = patch.bindings;
    if (Array.isArray(patch.parameters)) next.parameters = patch.parameters;
    if (isPlainObject(patch.defaults)) next.defaults = patch.defaults;
    if (isPlainObject(patch.presets)) next.presets = patch.presets;
    if (patch.inputContract === true) {
      const workflow = resolve(id)?.workflow;
      try {
        validateWorkflowContract(workflow, next.bindings, patch.outputNodes);
      } catch (error) {
        throw new RegistryError(error.message, { status: 422, code: "invalid_workflow_contract" });
      }
      next.inputContract = true;
      next.outputNodes = patch.outputNodes;
      next.draft = false;
    }

    data[index] = next;
    await writeJsonAtomic(registryPath, { version: 1, workflows: data });
    await load();
    // workflow 图在 load 后从 cache 取（注册表数据里只有 file 路径，没有图本体）。
    const workflow = resolve(id)?.workflow;
    const warnings = workflow ? [...bindingWarnings(workflow, next.bindings)] : [];
    if (!Object.keys(next.bindings || {}).length) warnings.push("还没有任何绑定，画布参数将无法传入工作流。");
    return { workflow: publicEntry(resolve(id)), warnings };
  }

  return {
    dir,
    registryPath,
    load,
    reloadIfChanged,
    list,
    resolve,
    resolveModel,
    listModels,
    resolveForMode,
    schema,
    importWorkflow: (input) => enqueueWrite(() => importWorkflow(input)),
    scan: () => enqueueWrite(scan),
    remove: (id) => enqueueWrite(() => remove(id)),
    updateWorkflow: (id, patch) => enqueueWrite(() => updateWorkflow(id, patch)),
    publicEntry,
    isLoaded: () => loaded,
  };
}
