/**
 * 键盘归属：打开着的对话框 / 抽屉自己处理按键，画布不该同时响应。
 *
 * antd 的 Modal 关 Esc 时既不 preventDefault 也不阻止冒泡，于是画布挂在
 * window 上的 keydown 也会执行「Esc 清空选中」——用户关掉生成历史后，
 * 正在编辑的节点面板跟着一起消失，得重新点一次节点才能继续。
 * 焦点若还在对话框里，从事件路径就能判断；Esc 之后焦点常掉回 body，
 * 所以再兜一层「文档里还有可见的对话框」，别只信 target。
 * 下拉菜单同理：菜单是「关掉它，别动画布」的意思，不是「清空选择」。
 */
const OVERLAY_SELECTOR = ".ant-modal-wrap, .ant-drawer-content-wrapper, .ant-dropdown:not(.ant-dropdown-hidden)";

export function openOverlayOwnsKeyboard(target: EventTarget | null) {
    if (target instanceof Element && target.closest(OVERLAY_SELECTOR)) return true;
    return Array.from(document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)).some((element) => element.getClientRects().length > 0);
}
