import { nanoid } from "nanoid";
import { collectGroupMemberNodes, nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import { projectSnapshotCodec } from "@/infrastructure/storage/snapshot-storage";
import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import type { CanvasExportFile } from "@/types/canvas-export";
import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";

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
