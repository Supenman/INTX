/**
 * 节点悬浮栏的 action → handler 映射。
 *
 * 注册表用 `action` 字符串描述意图（domain 层不能放回调），这里把它落成真实动作。
 * 刻意不写成通用 dispatcher：目前只有悬浮栏接表，写成通用一层等于给单点用法造抽象。
 * 将来底部工具栏 / 右键菜单接表时，各自加自己的映射即可。
 */
import type { CanvasNodeData } from "@/types/canvas";

export interface NodeToolbarActions {
    /** 打开节点信息弹层 */
    showInfo: (node: CanvasNodeData) => void;
    /** 复制节点（Ctrl+D 同一动作） */
    duplicate: (node: CanvasNodeData) => void;
    /** 删除节点（右键菜单「删除」同一动作） */
    remove: (node: CanvasNodeData) => void;
}

/** 注册表里 node-hover 的 action → 上面三个 handler 的键。 */
const ACTION_OF = {
    "show-node-info": "showInfo",
    "duplicate-node": "duplicate",
    "delete-node": "remove",
} as const satisfies Record<string, keyof NodeToolbarActions>;

/**
 * 取某个 action 对应的处理函数；没有映射时返回 null，
 * 调用方据此不渲染该条目（宁可少一个按钮，也不渲染一个点了没反应的）。
 */
export function nodeToolbarHandler(
    action: string,
    node: CanvasNodeData,
    actions: NodeToolbarActions,
): (() => void) | null {
    const key = ACTION_OF[action as keyof typeof ACTION_OF];
    if (!key) return null;
    return () => actions[key](node);
}
