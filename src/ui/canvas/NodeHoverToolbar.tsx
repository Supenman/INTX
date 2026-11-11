import {
  getNodeDefinition,
  resolveToolbarEntries,
  type ToolContext,
  type ToolbarPrefs,
} from '@/domain';
import { duplicateNodes, removeNodes } from '@/app/stores/graphStore';
import { useToolbarPrefs } from '@/app/toolPrefs';

/**
 * 节点悬浮工具栏。
 *
 * 只做两件事：用当前节点信息构造 ToolContext，把注册表解析结果渲染成按钮。
 * 「生成节点才显示生成按钮」「忙的时候换成取消」这类判断全在定义里，
 * 这里没有一条 if。
 *
 * 刻意不订阅 graphStore / historyStore：200 节点时每个卡片都挂订阅会拖垮压测。
 * node-hover 的工具谓词只看 ctx.node，其余字段给中性值即可。
 */
export interface NodeHoverToolbarProps {
  nodeId: string;
  defKind: string;
  hasAsset: boolean;
  busy: boolean;
  onGenerate: (nodeId: string) => void;
  onCancel: (nodeId: string) => void;
}

export function NodeHoverToolbar(props: NodeHoverToolbarProps) {
  const prefs: ToolbarPrefs | null = useToolbarPrefs((s) => s.prefs?.['node-hover'] ?? null);
  const def = getNodeDefinition(props.defKind);
  if (!def) return null;

  const ctx: ToolContext = {
    toolMode: 'select',
    selectedCount: 0,
    nodeCount: 0,
    clipboardCount: 0,
    canUndo: false,
    canRedo: false,
    demoMode: false,
    node: {
      kind: props.defKind,
      category: def.category,
      hasAsset: props.hasAsset,
      busy: props.busy,
    },
  };

  const entries = resolveToolbarEntries('node-hover', ctx, prefs);
  if (entries.length === 0) return null;

  const dispatch = (action: string) => {
    switch (action) {
      case 'duplicate-node':
        duplicateNodes([props.nodeId]);
        break;
      case 'generate-node':
        props.onGenerate(props.nodeId);
        break;
      case 'cancel-node':
        props.onCancel(props.nodeId);
        break;
      case 'delete-node':
        removeNodes([props.nodeId]);
        break;
      default:
        break;
    }
  };

  return (
    <div className="node-hover-toolbar nodrag" role="toolbar" aria-label="节点工具">
      {entries.map((entry) =>
        entry.kind === 'separator' ? (
          <span className="node-hover-sep" key={entry.id} />
        ) : (
          <button
            key={entry.tool.id}
            className={entry.tool.danger ? 'danger' : ''}
            data-tool-id={entry.tool.id}
            title={entry.tool.hint}
            disabled={entry.disabled}
            onClick={(e) => {
              e.stopPropagation();
              dispatch(entry.tool.action);
            }}
          >
            {entry.tool.label}
          </button>
        ),
      )}
    </div>
  );
}
