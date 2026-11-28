import { nanoid } from "nanoid";

import type { CanvasProject } from "@/application/persistence/types";

export type ProjectSortOrder = "recent" | "oldest" | "name" | "nodes";
export type LibraryViewMode = "grid" | "list";

export const PROJECT_SORT_OPTIONS: readonly ProjectSortOrder[] = ["recent", "oldest", "name", "nodes"] as const;

export function filterAndSortProjects(
    projects: CanvasProject[],
    options: {
        keyword: string;
        folderFilter?: string;
        sortOrder: ProjectSortOrder;
        locale?: string;
    },
): CanvasProject[] {
    const query = options.keyword.trim().toLowerCase();
    const filtered = projects.filter(
        (project) =>
            (!options.folderFilter || project.folder === options.folderFilter) &&
            (!query || [project.title, project.folder].some((value) => value?.toLowerCase().includes(query))),
    );
    return [...filtered].sort((a, b) => {
        if (options.sortOrder === "name") {
            return a.title.localeCompare(b.title, options.locale);
        }
        if (options.sortOrder === "nodes") {
            const byNodes = b.nodes.length - a.nodes.length;
            if (byNodes !== 0) return byNodes;
        }
        const byUpdated = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
        return options.sortOrder === "oldest" ? -byUpdated : byUpdated;
    });
}

export function buildDuplicateProjectInput(project: CanvasProject, copySuffix: string): Partial<CanvasProject> {
    const nodeIdMap = new Map<string, string>();
    for (const node of project.nodes) {
        nodeIdMap.set(node.id, nanoid());
    }
    const nodes = project.nodes.map((node) => {
        const cloned = structuredClone(node);
        const nextId = nodeIdMap.get(node.id) ?? nanoid();
        cloned.id = nextId;
        if (cloned.metadata?.groupId && nodeIdMap.has(cloned.metadata.groupId)) {
            cloned.metadata.groupId = nodeIdMap.get(cloned.metadata.groupId);
        }
        if (cloned.metadata?.versionOfNodeId && nodeIdMap.has(cloned.metadata.versionOfNodeId)) {
            cloned.metadata.versionOfNodeId = nodeIdMap.get(cloned.metadata.versionOfNodeId);
        }
        if (cloned.metadata?.retrySourceId && nodeIdMap.has(cloned.metadata.retrySourceId)) {
            cloned.metadata.retrySourceId = nodeIdMap.get(cloned.metadata.retrySourceId);
        }
        return cloned;
    });
    const connections = project.connections.map((conn) => ({
        ...structuredClone(conn),
        id: nanoid(),
        fromNodeId: nodeIdMap.get(conn.fromNodeId) ?? conn.fromNodeId,
        toNodeId: nodeIdMap.get(conn.toNodeId) ?? conn.toNodeId,
    }));
    const baseTitle = project.title.trim() || copySuffix;
    return {
        title: `${baseTitle} (${copySuffix})`,
        folder: project.folder,
        nodes,
        connections,
        backgroundMode: project.backgroundMode,
        showImageInfo: project.showImageInfo,
        viewport: project.viewport ? { ...project.viewport } : { x: 0, y: 0, k: 1 },
    };
}

export function readViewMode(storageKey: string, fallback: LibraryViewMode): LibraryViewMode {
    try {
        const stored = globalThis.localStorage?.getItem(storageKey);
        if (stored === "grid" || stored === "list") return stored;
    } catch {
        // Ignore storage read failures in restricted environments.
    }
    return fallback;
}

export function writeViewMode(storageKey: string, mode: LibraryViewMode): void {
    try {
        globalThis.localStorage?.setItem(storageKey, mode);
    } catch {
        // Ignore storage write failures in restricted environments.
    }
}
