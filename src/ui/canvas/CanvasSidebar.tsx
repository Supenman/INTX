import { listByCategory } from '@/domain';
import { AssetLibrary } from '@/ui/library/AssetLibrary';

/**
 * 左侧栏：品牌、节点入口、资产库、项目动作。
 *
 * 从 Canvas 拆出来是因为 Canvas 贴着 800 行结构预算；这里只做渲染与
 * 拖拽源标记，所有真正的动作仍由 Canvas 的回调执行，不另建状态。
 * 节点按钮同时支持点击添加和拖到画布（dataTransfer 标记类型）。
 */
export interface CanvasSidebarProps {
  onSpawn: (kind: string) => void;
  onOpenSettings: () => void;
  onOpenAudit: () => void;
  onOpenLegacy: () => void;
  onExport: () => void;
  onImport: () => void;
  onClear: () => void;
}

function NodePickerButton({ kind, title, onSpawn }: { kind: string; title: string; onSpawn: (kind: string) => void }) {
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-intx-node', kind);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onSpawn(kind)}
      title="点击添加，或拖到画布上"
    >
      {title}
    </button>
  );
}

export function CanvasSidebar(props: CanvasSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        INTX
        <button className="icon-btn" title="厂商设置" onClick={props.onOpenSettings}>
          ⚙
        </button>
      </div>

      <h3>素材</h3>
      <div className="node-picker">
        {listByCategory('source').map((d) => (
          <NodePickerButton key={d.kind} kind={d.kind} title={d.title} onSpawn={props.onSpawn} />
        ))}
      </div>

      <h3>生成</h3>
      <div className="node-picker">
        {listByCategory('generate').map((d) => (
          <NodePickerButton key={d.kind} kind={d.kind} title={d.title} onSpawn={props.onSpawn} />
        ))}
      </div>

      <AssetLibrary />

      <h3>项目</h3>
      <div className="node-picker">
        <button onClick={props.onOpenAudit} title="查看生成审计台账：厂商、出处、成本、复现">
          审计台账
        </button>
        <button onClick={props.onExport}>导出 .intx</button>
        <button onClick={props.onImport}>导入 .intx</button>
        <button onClick={props.onOpenLegacy} title="从旧版 BeastTV / INTX 的 localStorage 或 JSON 文件迁移">
          导入旧版数据
        </button>
        <button onClick={props.onClear} className="danger-text" title="可撤销；资产库不受影响">
          清空画布
        </button>
      </div>
    </aside>
  );
}
