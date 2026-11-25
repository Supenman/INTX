/**
 * 键盘归属：对话框关 Esc 时 antd 不 preventDefault 也不阻止冒泡，画布挂在
 * window 上的 keydown 会顺手执行「Esc 清空选中」，用户刚关掉生成历史，
 * 正在编辑的节点面板就没了。这里钉住守卫的判断：焦点还在浮层里、或者
 * 焦点已掉回 body 但屏幕上仍留着可见浮层，都算「键盘归浮层」。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { openOverlayOwnsKeyboard } from "./keyboard-scope";

// 画布用例跑在 node 环境，没有 DOM；只补守卫用到的那几个成员。
class FakeElement {
    constructor(private readonly insideOverlay: boolean) {}
    closest() {
        return this.insideOverlay ? this : null;
    }
}

const stubDocument = (overlays: boolean[]) => {
    const nodes = overlays.map((visible) => ({ getClientRects: () => (visible ? [{}] : []) }));
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("document", { querySelectorAll: () => nodes });
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("openOverlayOwnsKeyboard", () => {
    it("焦点在对话框内部时键盘归浮层", () => {
        stubDocument([]);
        expect(openOverlayOwnsKeyboard(new FakeElement(true) as unknown as EventTarget)).toBe(true);
    });

    it("焦点掉回 body，但还留着可见对话框时也归浮层", () => {
        stubDocument([true]);
        expect(openOverlayOwnsKeyboard(null)).toBe(true);
    });

    it("没有对话框时画布照常接管键盘", () => {
        stubDocument([false]);
        expect(openOverlayOwnsKeyboard(null)).toBe(false);
    });

    it("下拉菜单打开时键盘也归浮层，Esc 只关菜单", () => {
        stubDocument([false, false, true]);
        expect(openOverlayOwnsKeyboard(null)).toBe(true);
    });

    it("画布自身的元素不触发守卫", () => {
        stubDocument([]);
        expect(openOverlayOwnsKeyboard(new FakeElement(false) as unknown as EventTarget)).toBe(false);
    });
});
