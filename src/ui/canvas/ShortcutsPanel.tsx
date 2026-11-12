import { PanelMask } from '@/ui/common/PanelMask';

/**
 * 快捷键说明面板。按 ? 呼出，Esc 关闭。
 *
 * 清单与 Canvas 的 keydown 实现一一对应；改快捷键时两处同步。
 * 不追求穷举 React Flow 的内建手势，只列用户需要记住的那部分。
 */
const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: '编辑',
    items: [
      ['Ctrl+Z', '撤销'],
      ['Ctrl+Shift+Z / Ctrl+Y', '重做'],
      ['Ctrl+C / Ctrl+V', '复制 / 粘贴节点'],
      ['Ctrl+D', '复制选中节点'],
      ['Delete / Backspace', '删除选中'],
    ],
  },
  {
    title: '选择与画布',
    items: [
      ['Shift+点击', '加选 / 减选'],
      ['空白处拖动', '框选（区域选择模式）'],
      ['Space / 中键拖动', '临时平移画布'],
      ['Ctrl+1', '缩放到 100%'],
      ['Ctrl+2', '适应全部节点'],
      ['Ctrl+3', '适应选中节点'],
    ],
  },
  {
    title: '节点',
    items: [
      ['单击标题', '重命名'],
      ['双击空白 / 右键', '添加节点'],
      ['Ctrl+Enter（提示词编辑器）', '生成'],
      ['Esc', '关闭菜单 / 面板 / 放弃编辑'],
      ['?', '打开本面板'],
    ],
  },
];

export function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  return (
    <PanelMask onClose={onClose}>
      <div className="panel shortcuts-panel" role="dialog" aria-label="快捷键">
        <div className="panel-head">
          <h2>快捷键</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭" title="关闭 (Esc)">
            ×
          </button>
        </div>
        <div className="shortcuts-body">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h4>{group.title}</h4>
              {group.items.map(([keys, desc]) => (
                <div className="shortcut-row" key={keys}>
                  <kbd>{keys}</kbd>
                  <span>{desc}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </PanelMask>
  );
}
