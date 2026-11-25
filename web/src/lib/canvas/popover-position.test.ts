import { describe, expect, it } from "vitest";

import { resolvePopoverPosition } from "./popover-position";

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;

describe("resolvePopoverPosition", () => {
    it("空间够时贴在生成面板右侧，不压住面板", () => {
        const position = resolvePopoverPosition({
            buttonRect: rect(473, 773, 240, 32),
            anchorRect: rect(342, 405, 495, 269),
            viewport: { width: 1440, height: 900 },
        });

        // 面板右边 837 + 8 间距
        expect(position.left).toBe(845);
        expect(position.left).toBeGreaterThanOrEqual(837);
        expect(position.bottom).toBe(900 - 773 + 8);
        expect(position.maxHeight).toBe(773 - 8 - 12);
    });

    it("窄窗口左右都放不下时，向上展开停在生成面板顶边之上", () => {
        const position = resolvePopoverPosition({
            buttonRect: rect(320, 537, 240, 32),
            anchorRect: rect(256, 405, 495, 269),
            viewport: { width: 1024, height: 720 },
        });

        // 浮层底边应在面板顶部 405 以上，留出 8px 间距
        expect(position.bottom).toBe(720 - (405 - 8));
        expect(position.maxHeight).toBe(405 - 8 - 12);
    });

    it("窄窗口下不会因为避让把浮层压到读不了", () => {
        const position = resolvePopoverPosition({
            buttonRect: rect(20, 180, 200, 32),
            anchorRect: rect(10, 160, 300, 120),
            viewport: { width: 420, height: 360 },
        });

        expect(position.maxHeight).toBeGreaterThanOrEqual(220);
        expect(position.width).toBe(Math.min(356, 420 - 24));
    });

    it("向下展开时同样以面板底边为界，不盖住输入框", () => {
        const position = resolvePopoverPosition({
            buttonRect: rect(120, 300, 200, 32),
            anchorRect: rect(60, 260, 420, 180),
            viewport: { width: 620, height: 720 },
            placement: "bottomLeft",
        });

        expect(position.top).toBe(440 + 8);
        expect(position.maxHeight).toBe(Math.max(220, Math.min(720 - 448 - 88, 300 - 8 - 12)));
    });

    it("没有生成面板时退回按钮定位", () => {
        const position = resolvePopoverPosition({
            buttonRect: rect(100, 500, 120, 32),
            anchorRect: null,
            viewport: { width: 1000, height: 800 },
        });

        expect(position.left).toBe(220 + 8);
        expect(position.bottom).toBe(800 - 500 + 8);
    });
});
