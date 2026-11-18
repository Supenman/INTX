import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import { alignNodes, collectAlignUnits, distributeNodes } from "./canvas-align";

/** 只填对齐/分布会读的字段，其余给默认值。 */
function node(id: string, x: number, y: number, width = 100, height = 80, extra: Partial<CanvasNodeData> = {}): CanvasNodeData {
    return { id, type: CanvasNodeType.Image, position: { x, y }, width, height, metadata: {}, ...extra } as CanvasNodeData;
}

function group(id: string, x: number, y: number, width: number, height: number): CanvasNodeData {
    return { id, type: CanvasNodeType.Group, position: { x, y }, width, height, metadata: {} } as CanvasNodeData;
}

function member(id: string, x: number, y: number, groupId: string, width = 100, height = 80): CanvasNodeData {
    return { ...node(id, x, y, width, height), metadata: { groupId } } as CanvasNodeData;
}

const ids = (...list: string[]) => new Set(list);
const pos = (nodes: readonly CanvasNodeData[], id: string) => nodes.find((n) => n.id === id)!.position;

describe("alignNodes", () => {
    it("左对齐：全部左边缘压到最左", () => {
        const nodes = [node("a", 0, 0), node("b", 60, 200), node("c", 130, 400)];
        const next = alignNodes(nodes, ids("a", "b", "c"), "left");
        expect(next.map((n) => n.position.x)).toEqual([0, 0, 0]);
        // 纵向不动
        expect(next.map((n) => n.position.y)).toEqual([0, 200, 400]);
    });

    it("右对齐：按右边缘而不是左边缘", () => {
        const nodes = [node("a", 0, 0, 100), node("b", 50, 0, 40)];
        const next = alignNodes(nodes, ids("a", "b"), "right");
        expect(next.map((n) => n.position.x + n.width)).toEqual([100, 100]);
    });

    it("水平居中：对包围盒中心，而不是节点中心的平均值", () => {
        // 包围盒 20..240，中心 130。a 的中心 150 → -20；b 的中心 70 → +60；c 的中心 190 → -60。
        // 若改用「节点中心平均值」= (150+70+190)/3 ≈ 137，三者会落到 137 而不是包围盒中心 130。
        const nodes = [node("a", 100, 0, 100), node("b", 20, 0, 100), node("c", 140, 0, 100)];
        const next = alignNodes(nodes, ids("a", "b", "c"), "center-x");
        expect(next.map((n) => n.position.x + n.width / 2)).toEqual([130, 130, 130]);
        expect(pos(next, "a").x).toBe(80);
        expect(pos(next, "b").x).toBe(80);
        expect(pos(next, "c").x).toBe(80);
    });

    it("宽窄不一时水平居中用包围盒：宽节点不会被平均值带偏", () => {
        // 宽节点 0..400（中心 200），窄节点 0..40（中心 20）。包围盒 0..400，中心 200。
        const nodes = [node("wide", 0, 0, 400), node("narrow", 0, 200, 40)];
        const next = alignNodes(nodes, ids("wide", "narrow"), "center-x");
        expect(pos(next, "narrow").x).toBe(180);
        // 若按中心平均值（110）算，宽节点会被推到 -90——视觉上明显歪。
        expect(pos(next, "wide").x).toBe(0);
    });

    it("顶对齐与底对齐各自动 y", () => {
        // 包围盒纵向 10..100（a: 10..60，b: 80..100）。
        const nodes = [node("a", 0, 10, 100, 50), node("b", 300, 80, 100, 20)];
        expect(alignNodes(nodes, ids("a", "b"), "top").map((n) => n.position.y)).toEqual([10, 10]);
        // 底对齐：下边缘都压到 100，a 需要 +40。
        expect(alignNodes(nodes, ids("a", "b"), "bottom").map((n) => n.position.y + n.height)).toEqual([100, 100]);
    });

    it("只动选中的节点，未选中的保持原引用", () => {
        const untouched = node("z", 500, 500);
        const nodes = [node("a", 0, 0), node("b", 60, 200), untouched];
        const next = alignNodes(nodes, ids("a", "b"), "left");
        expect(next[2]).toBe(untouched);
    });

    it("已经对齐时返回原数组引用，调用方据此跳过 undo", () => {
        const nodes = [node("a", 0, 0), node("b", 0, 200)];
        expect(alignNodes(nodes, ids("a", "b"), "left")).toBe(nodes);
    });

    it("只有一个节点时什么也不做", () => {
        const nodes = [node("a", 10, 0)];
        expect(alignNodes(nodes, ids("a"), "left")).toBe(nodes);
    });

    it("选中的是分组框时只移动分组框，成员随分组一起平移", () => {
        const g = group("g", 100, 100, 400, 300);
        const members = [member("m1", 120, 140, "g"), member("m2", 300, 140, "g")];
        const next = alignNodes([g, node("solo", 0, 0), ...members], ids("g", "solo"), "left");
        // 分组框左边缘压到 0 → 位移 -100。
        expect(pos(next, "g").x).toBe(0);
        // 成员坐标是绝对值，必须跟着走 -100，否则分组框飞走、节点留在原地。
        expect(pos(next, "m1").x).toBe(20);
        expect(pos(next, "m2").x).toBe(200);
        // 纵向没有位移，不应被碰到。
        expect(pos(next, "m1").y).toBe(140);
    });

    it("分组平移不影响同一分组里没被选中的成员", () => {
        const g = group("g", 100, 0, 400, 300);
        const inside = member("m1", 150, 0, "g");
        const next = alignNodes([g, inside, node("solo", 0, 0)], ids("g", "solo"), "left");
        expect(pos(next, "m1").x).toBe(50);
    });

    it("同时选中分组与其成员时不重复计一次平移", () => {
        const g = group("g", 100, 0, 400, 300);
        const m1 = member("m1", 120, 0, "g");
        const nodes = [g, m1, node("solo", 0, 0)];
        // 若把 m1 也算作独立单元，它的左边缘 120 会参与取最小值，结果相同但语义错。
        const units = collectAlignUnits(nodes, ids("g", "m1", "solo"));
        expect(units.map((u) => u.id)).toEqual(["g", "solo"]);
    });

    it("选中的分组变多时仍只按分组框对齐", () => {
        const g1 = group("g1", 0, 0, 300, 200);
        const g2 = group("g2", 500, 0, 300, 200);
        const nodes = [g1, member("m1", 20, 20, "g1"), g2, member("m2", 520, 20, "g2")];
        const next = alignNodes(nodes, ids("g1", "g2"), "left");
        expect(pos(next, "g2").x).toBe(0);
    });
});

describe("distributeNodes", () => {
    it("水平等距：首尾不动，中间节点让间距相等", () => {
        // a: 0..100, c: 500..600。gap = (600 - 0 - 300) / 2 = 150。b 应落在 250。
        const nodes = [node("a", 0, 0), node("b", 400, 0), node("c", 500, 0)];
        const next = distributeNodes(nodes, ids("a", "b", "c"), "horizontal");
        expect(pos(next, "a").x).toBe(0);
        expect(pos(next, "b").x).toBe(250);
        expect(pos(next, "c").x).toBe(500);
    });

    it("按位置排序而不是按传入顺序", () => {
        const nodes = [node("c", 500, 0), node("a", 0, 0), node("b", 400, 0)];
        const next = distributeNodes(nodes, ids("a", "b", "c"), "horizontal");
        expect(pos(next, "b").x).toBe(250);
    });

    it("节点宽窄不一时按空隙等距，不按中心距", () => {
        // a: 0..40, c: 300..340。总宽 40+20+40=100，gap=(340-0-100)/2=120。
        // b 宽 20 应落在 40+120=160。
        const nodes = [node("a", 0, 0, 40), node("b", 100, 0, 20), node("c", 300, 0, 40)];
        const next = distributeNodes(nodes, ids("a", "b", "c"), "horizontal");
        expect(pos(next, "b").x).toBe(160);
    });

    it("垂直等距只动 y", () => {
        const nodes = [node("a", 0, 0), node("b", 0, 400), node("c", 0, 500)];
        const next = distributeNodes(nodes, ids("a", "b", "c"), "vertical");
        expect(pos(next, "b").y).toBe(250);
        expect(next.map((n) => n.position.x)).toEqual([0, 0, 0]);
    });

    it("少于三个节点时不分布", () => {
        const nodes = [node("a", 0, 0), node("b", 400, 0)];
        expect(distributeNodes(nodes, ids("a", "b"), "horizontal")).toBe(nodes);
    });

    it("重叠的节点允许负间距拉开，不做最小间距钳制", () => {
        // a: 0..100, b: 20..120, c: 40..140。总宽 300，gap = (140-0-300)/2 = -80。
        const nodes = [node("a", 0, 0), node("b", 20, 0), node("c", 40, 0)];
        const next = distributeNodes(nodes, ids("a", "b", "c"), "horizontal");
        expect(pos(next, "b").x).toBe(20);
        expect(pos(next, "c").x).toBe(40);
    });

    it("未选中的节点不参与、也不被改动", () => {
        const outsider = node("z", 999, 0);
        const nodes = [node("a", 0, 0), node("b", 400, 0), node("c", 500, 0), outsider];
        const next = distributeNodes(nodes, ids("a", "b", "c"), "horizontal");
        expect(next[3]).toBe(outsider);
    });
});
