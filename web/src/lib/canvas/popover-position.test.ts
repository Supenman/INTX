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

    it("上方放不下实际高度时改向下展开，不把浮层挤成一条细缝", () => {
        const panelHeight = 380;
        const position = resolvePopoverPosition({
            buttonRect: rect(320, 200, 240, 32),
            anchorRect: rect(256, 60, 495, 200),
            viewport: { width: 1024, height: 640 },
            panelHeight,
        });

        // 向上只剩 60 - 8 = 52，下方 640 - 268 - 88 = 284 明显更宽裕，改到面板底边 260 之下
        expect(position.top).toBe(260 + 8);
        expect(position.bottom).toBeUndefined();
        expect(position.maxHeight).toBe(Math.max(220, Math.min(640 - 268 - 88, 200 - 8 - 12)));
    });

    it("上方空间够时保持向上展开，不因为浮层偏高就翻面", () => {
        const panelHeight = 380;
        const position = resolvePopoverPosition({
            buttonRect: rect(320, 520, 240, 32),
            anchorRect: rect(256, 300, 495, 200),
            viewport: { width: 1024, height: 640 },
            panelHeight,
        });

        expect(position.bottom).toBe(640 - (300 - 8));
        expect(position.top).toBeUndefined();
    });

    it("上下都局促时维持原方向，靠内部滚动而不是来回翻面", () => {
        const panelHeight = 520;
        const position = resolvePopoverPosition({
            buttonRect: rect(320, 330, 240, 32),
            anchorRect: rect(256, 300, 495, 200),
            viewport: { width: 1024, height: 640 },
            panelHeight,
        });

        expect(position.bottom).toBe(640 - (300 - 8));
    });
});
