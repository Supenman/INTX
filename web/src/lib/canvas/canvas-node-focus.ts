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
