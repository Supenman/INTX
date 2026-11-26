/**
 * 画布设置浮层的定位规则（纯函数，只算几何，不碰 DOM 之外的副作用）。
 *
 * 四个设置浮层（图片/视频/音频/文本）曾经各抄一份算式，宽度、避让和夹取
 * 逐渐走样。这里统一成一份，浮层只负责渲染内容。
 */

export type PopoverPlacement = "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";

export type PopoverViewport = {
    width: number;
    height: number;
};

export type PopoverPosition = {
    width: number;
    left: number;
    /** 向上展开时用 bottom 定位，避免内容高度变化时顶边跳动。 */
    top?: number;
    bottom?: number;
    maxHeight: number;
};

type ResolvePopoverPositionInput = {
    buttonRect: DOMRect;
    /** 触发按钮所属的生成面板；水平避让以它为界，避免压住输入区。 */
    anchorRect?: DOMRect | null;
    viewport: PopoverViewport;
    placement?: PopoverPlacement;
    width?: number;
    gap?: number;
    margin?: number;
    /** 底部工具坞占位：向下展开时留出这段，避免盖住工具坞。 */
    dockInset?: number;
    /** 浮层上一次渲染的实测高度；首帧没有就按未知处理（维持原方向）。 */
    panelHeight?: number | null;
};

const DEFAULT_WIDTH = 356;
const DEFAULT_GAP = 8;
const DEFAULT_MARGIN = 12;
const DEFAULT_DOCK_INSET = 88;
/** 空间不够时也不把面板压到读不了，宁可让内容滚动。 */
const MIN_HEIGHT = 220;
/** 上方能放下这么多内容就仍然向上展开，避免在临界高度来回翻面。 */
const PREFERRED_HEIGHT = 300;
/** 下方要比上方多出这么多空间才值得翻面，否则来回翻的收益不如稳定。 */
const FLIP_GAIN = 120;

export function resolvePopoverPosition({
    buttonRect,
    anchorRect,
    viewport,
    placement = "topLeft",
    width = DEFAULT_WIDTH,
    gap = DEFAULT_GAP,
    margin = DEFAULT_MARGIN,
    dockInset = DEFAULT_DOCK_INSET,
    panelHeight,
}: ResolvePopoverPositionInput): PopoverPosition {
    const resolvedWidth = Math.min(width, viewport.width - margin * 2);
    const alignRight = placement.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";

    // 水平定位：优先贴在生成面板右侧/左侧的空隙里，两侧都不够才退回按钮对齐。
    const anchor = anchorRect ?? buttonRect;
    const spaceRight = viewport.width - anchor.right - gap - margin;
    const spaceLeft = anchor.left - gap - margin;
    const preferredLeft = alignCenter ? buttonRect.left + buttonRect.width / 2 - resolvedWidth / 2 : alignRight ? buttonRect.right - resolvedWidth : buttonRect.left;
    const left = Math.max(
        margin,
        Math.min(
            viewport.width - resolvedWidth - margin,
            alignCenter || alignRight
                ? preferredLeft
                : spaceRight >= resolvedWidth
                    ? anchor.right + gap
                    : spaceLeft >= resolvedWidth
                        ? anchor.left - gap - resolvedWidth
                        : buttonRect.right - resolvedWidth,
        ),
    );

    // 窄窗口下左右都塞不进浮层，它只能盖在生成面板上方。此时改为以面板本身为界：
    // 向上展开就停在面板顶边之上，向下展开就退到面板底边之下，保证输入框和
    // 生成按钮始终可见；浮层自己在这段空间里滚动。
    const overlapsAnchor = anchorRect ? left < anchorRect.right && left + resolvedWidth > anchorRect.left : false;
    let topPlacement = placement.startsWith("top");

    const edgeFor = (up: boolean) =>
        up
            ? (overlapsAnchor && anchorRect ? Math.min(buttonRect.top, anchorRect.top) - gap : buttonRect.top - gap)
            : (overlapsAnchor && anchorRect ? Math.max(buttonRect.bottom, anchorRect.bottom) + gap : buttonRect.bottom + gap);
    const maxHeightFor = (up: boolean, edge: number) =>
        up ? Math.max(MIN_HEIGHT, edge - margin) : Math.max(MIN_HEIGHT, Math.min(viewport.height - edge - dockInset, buttonRect.top - gap - margin));

    // 桌面窗口最小高度只有 640：按钮贴着生成面板底部时，向上展开只剩一两百像素，
    // 面板得在里面滚很久；而下方的空白往往够用。按上一次实测高度判断，下方明显
    // 更宽裕就翻到下面展开。下方不压住面板时用画布底边（不含工具坞）作为下界，
    // 避免工具坞预留量把可用的下方空间算没了。
    if (topPlacement && panelHeight && panelHeight > 0) {
        const upwardSpace = edgeFor(true) - margin;
        const downEdge = edgeFor(false);
        const bottomLimit = viewport.height - dockInset;
        const downwardSpace = (overlapsAnchor ? bottomLimit : viewport.height) - downEdge;
        const wantsDown = upwardSpace < Math.min(panelHeight, PREFERRED_HEIGHT) && downwardSpace > upwardSpace + FLIP_GAIN;
        if (wantsDown) topPlacement = false;
    }

    const edge = edgeFor(topPlacement);
    const maxHeight = maxHeightFor(topPlacement, edge);

    return {
        width: resolvedWidth,
        left,
        ...(topPlacement ? { bottom: viewport.height - edge } : { top: edge }),
        maxHeight,
    };
}
