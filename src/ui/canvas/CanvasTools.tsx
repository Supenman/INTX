import type { MouseEvent } from 'react';
import { listByCategory, type AlignMode, type DistributeAxis } from '@/domain';

/**
 * 画布基本功的几块浮层 UI。
 *
 * 全部是纯展示组件：不读 store、不写图，动作由 Canvas 通过 props 传进来。
 * 这样工具条 / 菜单的排版可以单独改，不会把交互逻辑散进多个文件。
 */

export type ToolMode = 'select' | 'hand';

export function ModeSwitch({ mode, onChange }: { mode: ToolMode; onChange: (m: ToolMode) => void }) {
  return (
    <div className="mode-switch" role="group" aria-label="画布工具">
      <button
        className={mode === 'select' ? 'active' : ''}
        onClick={() => onChange('select')}
        title="区域选择：空白处拖动框选节点（空格或中键可临时平移）"
      >
        区域选择
      </button>
      <button
        className={mode === 'hand' ? 'active' : ''}
        onClick={() => onChange('hand')}
        title="抓手：拖动画布平移（空格或中键在任意模式下都可临时平移）"
      >
        抓手
      </button>
    </div>
  );
}

export interface SelectionToolbarProps {
  count: number;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: DistributeAxis) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onChain: () => void;
  onAutoArrange: () => void;
}

/** 框选多个节点后出现的悬浮栏；单选时不打扰。 */
export function SelectionToolbar(props: SelectionToolbarProps) {
  const { count } = props;
  if (count < 2) return null;
  return (
    <div className="selection-toolbar" role="toolbar" aria-label={`已选中 ${count} 个节点`}>
      <span className="selection-count">已选 {count}</span>
      <span className="toolbar-sep" />
      <button onClick={() => props.onAlign('left')} title="左对齐">左对齐</button>
      <button onClick={() => props.onAlign('center-x')} title="水平居中">水平居中</button>
      <button onClick={() => props.onAlign('right')} title="右对齐">右对齐</button>
      <button onClick={() => props.onAlign('top')} title="顶对齐">顶对齐</button>
      <button onClick={() => props.onAlign('center-y')} title="垂直居中">垂直居中</button>
      <button onClick={() => props.onAlign('bottom')} title="底对齐">底对齐</button>
      <span className="toolbar-sep" />
      <button onClick={() => props.onDistribute('horizontal')} title="水平等距（至少 3 个）">水平等距</button>
      <button onClick={() => props.onDistribute('vertical')} title="垂直等距（至少 3 个）">垂直等距</button>
      <span className="toolbar-sep" />
      <button onClick={props.onChain} title="按从左到右的顺序依次连接可用端口">批量连接</button>
      <button onClick={props.onAutoArrange} title="按依赖层级与媒体泳道整理选中节点，可撤销">整理选区</button>
      <button onClick={props.onDuplicate} title="复制一份 (Ctrl+D)">复制</button>
      <button className="danger" onClick={props.onDelete} title="删除选中节点 (Delete)">删除</button>
    </div>
  );
}

export interface AddMenuProps {
  x: number;
  y: number;
  onPick: (kind: string) => void;
  onClose: () => void;
  canPaste: boolean;
  onPaste: () => void;
  onAutoArrange: () => void;
}

/** 右键空白处 / 空画布起始框共用的添加菜单，同一份节点注册表不维护第二份清单。 */
export function AddMenu(props: AddMenuProps) {
  const groups: { title: string; category: 'source' | 'generate' | 'utility' }[] = [
    { title: '素材与输入', category: 'source' },
    { title: '生成', category: 'generate' },
    { title: '工具', category: 'utility' },
  ];
  return (
    <>
      <div className="menu-backdrop" onClick={props.onClose} onContextMenu={(e) => e.preventDefault()} />
      <div className="add-menu" style={{ left: props.x, top: props.y }} role="menu">
        <div className="add-menu-head">添加节点</div>
        {groups.map((g) => {
          const defs = listByCategory(g.category);
          if (defs.length === 0) return null;
          return (
            <div className="add-menu-group" key={g.category}>
              <div className="add-menu-label">{g.title}</div>
              {defs.map((d) => (
                <button key={d.kind} role="menuitem" onClick={() => props.onPick(d.kind)}>
                  {d.title}
                </button>
              ))}
            </div>
          );
        })}
        <div className="add-menu-group">
          <div className="add-menu-label">画布</div>
          <button role="menuitem" onClick={props.onPaste} disabled={!props.canPaste}>
            粘贴 {props.canPaste ? '(Ctrl+V)' : '(剪贴板为空)'}
          </button>
          <button role="menuitem" onClick={props.onAutoArrange}>自动整理节点</button>
        </div>
        <div className="add-menu-foot">Delete 删除 · Ctrl+D 复制 · Shift 加选</div>
      </div>
    </>
  );
}

/** 空画布中央的起始框：只提供入口，不创建占位节点。 */
export function CanvasStarter({ onOpen }: { onOpen: (e: MouseEvent) => void }) {
  return (
    <button className="canvas-starter" onClick={onOpen} title="打开添加菜单">
      <span className="canvas-starter-plus">+</span>
      <strong>从这里开始</strong>
      <span>点一下添加节点，或右键画布任意位置</span>
      <span className="canvas-starter-hint">也可以从左栏添加 · 当前为本地演示厂商，不会出真图</span>
    </button>
  );
}
