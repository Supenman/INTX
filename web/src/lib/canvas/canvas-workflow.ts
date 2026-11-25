import { nanoid } from "nanoid";
import { collectGroupMemberNodes, nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import { projectSnapshotCodec } from "@/infrastructure/storage/snapshot-storage";
import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import type { CanvasExportFile } from "@/types/canvas-export";
import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";
import type { ComfyWorkflowContract, WorkflowValue, WorkflowValues } from "@/types/comfy-workflow";

export type CanvasSubgraph = { nodes: CanvasNodeData[]; connections: CanvasConnection[] };

export function selectWorkflow(nodes: CanvasNodeData[], connections: CanvasConnection[], selection: Set<string>): CanvasSubgraph {
    const ids = new Set([...selection, ...collectGroupMemberNodes(selection, nodes).map((node) => node.id)]);
    return {
        nodes: nodes.filter((node) => ids.has(node.id)),
        connections: connections.filter((edge) => ids.has(edge.fromNodeId) && ids.has(edge.toNodeId)),
    };
}

export function placeCanvasSubgraph(graph: CanvasSubgraph, center: Position, pasteClipboard = false): CanvasSubgraph {
    if (!graph.nodes.length) return { nodes: [], connections: [] };
    const bounds = nodeBounds(graph.nodes);
    const dx = center.x - (bounds.left + bounds.right) / 2;
    const dy = center.y - (bounds.top + bounds.bottom) / 2;
    const ids = new Map(graph.nodes.map((node) => [node.id, `${node.type}-${nanoid()}`]));
    const nodes = graph.nodes.map((node) => {
        const metadata = node.metadata ? { ...node.metadata } : undefined;
        if (metadata?.imageTaskId) delete metadata.imageTaskId;
        if (metadata?.groupId) metadata.groupId = ids.get(metadata.groupId);
        if (metadata && !pasteClipboard) {
            delete metadata.videoTaskId;
            delete metadata.videoTaskProvider;
            delete metadata.retrySourceId;
            delete metadata.retryBlocked;
            delete metadata.errorDetails;
            if (metadata.status === "loading" || metadata.status === "error") metadata.status = metadata.content ? "success" : "idle";
            metadata.images = metadata.images?.filter((image) => image.status === "success");
            metadata.texts = metadata.texts?.filter((text) => text.status === "success");
            if (!metadata.images?.some((image) => image.id === metadata.primaryImageId)) delete metadata.primaryImageId;
            if (!metadata.texts?.some((text) => text.id === metadata.primaryTextId)) delete metadata.primaryTextId;
        }
        return {
            ...node,
            id: ids.get(node.id)!,
            title: pasteClipboard && !node.title.endsWith(" Copy") ? `${node.title} Copy` : node.title,
            position: { x: node.position.x + dx, y: node.position.y + dy },
            metadata,
        };
    });
    const connections = graph.connections.flatMap((edge) => {
        const fromNodeId = ids.get(edge.fromNodeId) ?? (pasteClipboard ? edge.fromNodeId : undefined);
        const toNodeId = ids.get(edge.toNodeId);
        return fromNodeId && toNodeId ? [{ ...edge, id: `conn-${nanoid()}`, fromNodeId, toNodeId }] : [];
    });
    return { nodes, connections };
}

export async function readCanvasWorkflow(file: File): Promise<CanvasSubgraph> {
    const zip = await readZip(file);
    const manifest = zip.get("projects.json");
    if (!manifest) throw new Error("Missing workflow manifest");
    const data = JSON.parse(await manifest.text()) as CanvasExportFile;
    if (data.app !== "infinite-canvas" || data.version !== 3 || data.projects?.length !== 1) throw new Error("Invalid workflow archive");
    const { project, files } = data.projects[0];
    const snapshot = projectSnapshotCodec.copy({ projects: [project], deletedProjects: [] });
    if (!snapshot.ok || !project.nodes.length || !Array.isArray(files)) throw new Error("Invalid workflow graph");
    if (new Set(project.nodes.map((node) => node.id)).size !== project.nodes.length) throw new Error("Duplicate workflow node ID");
    const assets = new Map<string, { path: string; mimeType: string }>();
    for (const item of files) {
        if (typeof item.storageKey !== "string" || typeof item.path !== "string" || typeof item.mimeType !== "string" || !zip.has(item.path)) throw new Error("Invalid workflow media");
        assets.set(item.storageKey, item);
    }
    const mediaIds = new Map<string, string>();
    await Promise.all([...assets].map(async ([oldKey, item]) => {
        const image = oldKey.startsWith("image:");
        const newKey = `${image ? "image" : oldKey.split(":")[0]}:${nanoid()}`;
        const fileBlob = zip.get(item.path)!;
        const blob = fileBlob.slice(0, fileBlob.size, item.mimeType);
        await (image ? setImageBlob(newKey, blob) : setMediaBlob(newKey, blob));
        mediaIds.set(oldKey, newKey);
    }));
    const nodes = snapshot.value.projects[0].nodes.map((node) => {
        const metadata = node.metadata;
        if (!metadata) return node;
        return { ...node, metadata: {
            ...metadata,
            storageKey: metadata.storageKey ? mediaIds.get(metadata.storageKey) : undefined,
            images: metadata.images?.map((image) => ({ ...image, storageKey: image.storageKey ? mediaIds.get(image.storageKey) : undefined })),
        } };
    });
    return { nodes, connections: snapshot.value.projects[0].connections };
}
/**
 * 必填校验：工作流声明了 required 的字段如果既没填也没默认值，提交时后端
 * 只会回一句网关错误，用户不知道是哪个参数没填。这里把缺的字段算出来，
 * 供提交前拦下并点名。
 *
 * 判定与 canvas-workflow-settings 的写法对齐：
 * - 媒体字段、提示词、张数由节点连线与面板负责，不在浮层里，不算；
 * - 用户清空（undefined）但字段声明了 default，仍按默认值提交，不算缺；
 * - 布尔字段的 false 是有效值，不能按 falsy 判成缺失；
 * - 字符串空串等于没填。
 */

const isEmpty = (value: WorkflowValue | undefined) => value === undefined || (typeof value === "string" && value.trim() === "");

export function missingWorkflowFields(workflow: ComfyWorkflowContract | undefined, values: Record<string, WorkflowValue> | undefined) {
    if (!workflow) return [];
    return workflow.fields
        .filter((field) => field.required && !field.media && field.from !== "prompt" && field.from !== "count" && field.default === undefined)
        .filter((field) => isEmpty(values?.[field.key]))
        .map((field) => field.key);
}

/** 每个模型只认自己那份参数，切换模型不会把上一个模型的填写带过去。 */
export function workflowValuesFor(values: WorkflowValues | undefined, model: string) {
    return values?.[model] || {};
}
