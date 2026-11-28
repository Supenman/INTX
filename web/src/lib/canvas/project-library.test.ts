import { describe, expect, it } from "vitest";

import type { CanvasProject } from "@/application/persistence/types";
import { CanvasNodeType } from "@/types/canvas";
import { buildDuplicateProjectInput, filterAndSortProjects } from "./project-library";

function makeProject(overrides: Partial<CanvasProject> & { id: string; title: string; updatedAt: string }): CanvasProject {
    return {
        createdAt: overrides.updatedAt,
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        ...overrides,
    };
}

describe("project-library", () => {
    const projects: CanvasProject[] = [
        makeProject({
            id: "p1",
            title: "Beta Storyboard",
            folder: "Drama",
            updatedAt: "2026-10-01T10:00:00.000Z",
            nodes: [
                { id: "n1", type: CanvasNodeType.Text, title: "T1", position: { x: 0, y: 0 }, width: 200, height: 120 },
            ],
        }),
        makeProject({
            id: "p2",
            title: "Alpha Lookbook",
            folder: "Brand",
            updatedAt: "2026-10-05T10:00:00.000Z",
            nodes: [
                { id: "n2", type: CanvasNodeType.Image, title: "I1", position: { x: 0, y: 0 }, width: 320, height: 240 },
                { id: "n3", type: CanvasNodeType.Image, title: "I2", position: { x: 360, y: 0 }, width: 320, height: 240 },
                { id: "n4", type: CanvasNodeType.Video, title: "V1", position: { x: 720, y: 0 }, width: 320, height: 240 },
            ],
        }),
        makeProject({
            id: "p3",
            title: "Gamma Trailer",
            folder: "Drama",
            updatedAt: "2026-10-03T10:00:00.000Z",
            nodes: [],
        }),
    ];

    it("sorts projects by recent, oldest, name, and node count", () => {
        expect(filterAndSortProjects(projects, { keyword: "", sortOrder: "recent" }).map((p) => p.id)).toEqual(["p2", "p3", "p1"]);
        expect(filterAndSortProjects(projects, { keyword: "", sortOrder: "oldest" }).map((p) => p.id)).toEqual(["p1", "p3", "p2"]);
        expect(filterAndSortProjects(projects, { keyword: "", sortOrder: "name", locale: "en-US" }).map((p) => p.id)).toEqual(["p2", "p1", "p3"]);
        expect(filterAndSortProjects(projects, { keyword: "", sortOrder: "nodes" }).map((p) => p.id)).toEqual(["p2", "p1", "p3"]);
    });

    it("filters by folder and keyword", () => {
        expect(filterAndSortProjects(projects, { keyword: "", folderFilter: "Drama", sortOrder: "recent" }).map((p) => p.id)).toEqual(["p3", "p1"]);
        expect(filterAndSortProjects(projects, { keyword: "trailer", folderFilter: "Drama", sortOrder: "recent" }).map((p) => p.id)).toEqual(["p3"]);
    });

    it("clones project with fresh node/connection IDs and remapped references", () => {
        const source = makeProject({
            id: "src-1",
            title: "Episode 1",
            folder: "Series",
            updatedAt: "2026-10-05T10:00:00.000Z",
            nodes: [
                { id: "grp-1", type: CanvasNodeType.Group, title: "Group", position: { x: 0, y: 0 }, width: 600, height: 400 },
                { id: "node-a", type: CanvasNodeType.Text, title: "Prompt", position: { x: 20, y: 20 }, width: 240, height: 140, metadata: { groupId: "grp-1", content: "hello" } },
                { id: "node-b", type: CanvasNodeType.Image, title: "Shot", position: { x: 320, y: 20 }, width: 240, height: 180, metadata: { groupId: "grp-1", retrySourceId: "node-a" } },
            ],
            connections: [
                { id: "conn-1", fromNodeId: "node-a", toNodeId: "node-b" },
            ],
        });

        const dup = buildDuplicateProjectInput(source, "副本");
        expect(dup.title).toBe("Episode 1 (副本)");
        expect(dup.folder).toBe("Series");
        expect(dup.nodes).toHaveLength(3);
        expect(dup.connections).toHaveLength(1);

        const [grp, nodeA, nodeB] = dup.nodes!;
        expect(grp.id).not.toBe("grp-1");
        expect(nodeA.id).not.toBe("node-a");
        expect(nodeB.id).not.toBe("node-b");
        expect(nodeA.metadata?.groupId).toBe(grp.id);
        expect(nodeB.metadata?.groupId).toBe(grp.id);
        expect(nodeB.metadata?.retrySourceId).toBe(nodeA.id);
        expect(dup.connections![0].id).not.toBe("conn-1");
        expect(dup.connections![0].fromNodeId).toBe(nodeA.id);
        expect(dup.connections![0].toNodeId).toBe(nodeB.id);
    });
});
