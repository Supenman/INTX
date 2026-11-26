/**
 * 把键盘焦点交给画布节点本身。
 *
 * 生成历史 / 版本对比都是模态：点「定位」后模态关闭，antd 会把焦点还给触发按钮，
 * 而那个按钮往往在已卸载的菜单里，焦点最终落到 body——键盘用户按 Tab 会从页面
 * 开头重来，等于刚定位的节点又被甩开。节点的根元素带 tabIndex={-1}，可以直接聚焦。
 */
export function focusNodeElement(nodeId: string) {
    requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`)?.focus({ preventScroll: true });
    });
}

/**
 * 模态关掉后焦点落到 body 时，把焦点还给画布容器。
 *
 * 生成历史是从「添加节点」菜单里打开的，菜单在模态弹出时已经卸载，antd 找不到
 * 可归还焦点的触发器，关闭后 activeElement 直接变成 body——键盘用户按 Tab 只能
 * 从顶栏第一个按钮重来。画布容器本身带 tabIndex={-1}，聚焦它之后 Tab 会继续走
 * 画布里的工具，位置和视觉上「回到画布」一致。已经有焦点归属（例如定位到节点）时不接管。
 */
export function restoreCanvasFocus() {
    requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        document.querySelector<HTMLElement>("[data-canvas-root]")?.focus({ preventScroll: true });
    });
}
