/** 用户工作流的明确输入/输出约定；自动推断只提供候选绑定。 */
export function workflowContract(entry) {
  if (!entry.inputContract) return undefined;
  return {
    fields: Object.entries(entry.bindings || {}).map(([key, binding]) => {
      const original = entry.workflow?.[binding.node]?.inputs?.[binding.input];
      const value = binding.transform ? undefined : original;
      const input = String(binding.input || "").toLowerCase();
      const frameRole = /^(first_frame|start_frame|start_image)$/.test(input) ? "firstFrame"
        : /^(last_frame|end_frame|end_image)$/.test(input) ? "lastFrame" : undefined;
      return { key, from: binding.from || key, required: binding.required === true, frameRole,
        media: binding.array
          ? binding.loadType === "video" || binding.from === "video" ? "video" : binding.loadType === "audio" || binding.from === "audio" ? "audio" : "image"
          : binding.imageIndex !== undefined || binding.from === "image" ? "image" : binding.from === "video" ? "video" : undefined,
        imageIndex: binding.imageIndex, videoIndex: binding.videoIndex, min: binding.min, max: binding.max, array: binding.array === true,
        type: typeof original === "number" || binding.transform && binding.transform !== "boolean" ? "number" : typeof original === "boolean" || binding.transform === "boolean" ? "boolean" : "string",
        default: (binding.from || key) !== "prompt" && ["string", "number", "boolean"].includes(typeof value) ? value : undefined,
        transform: binding.transform };
    }),
    outputNodes: entry.outputNodes || [],
    ...(entry.type === "image" ? { asyncImages: true } : {}),
  };
}

export function validateWorkflowContract(workflow, bindings, outputNodes) {
  if (!Array.isArray(outputNodes) || !outputNodes.length) throw new Error("请选择至少一个结果输出节点。");
  for (const id of outputNodes) {
    if (!workflow[id]) throw new Error(`输出节点 ${id} 不存在。`);
  }
  for (const [key, binding] of Object.entries(bindings || {})) {
    const node = workflow[binding?.node];
    if (!node || !Object.hasOwn(node.inputs, binding.input)) throw new Error(`绑定 ${key} 必须选择有效的节点和输入。`);
    const original = node.inputs[binding.input];
    if ((binding.from === "image" || binding.imageIndex !== undefined) && !binding.array && Array.isArray(original) && !binding.asLink) {
      throw new Error(`绑定 ${key} 的目标是连线，请选择“图片节点连线”。`);
    }
  }
}
