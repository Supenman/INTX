import { useReactFlow } from '@xyflow/react';
import { useActiveNode } from '../ActiveNodeContext';

const DuplicateIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const DeleteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export default function NodeToolbar({ id }) {
  const { activeNodeId } = useActiveNode() || {};
  const { deleteElements, getNodes, setNodes } = useReactFlow();
  const selectedCount = getNodes().filter((n) => n.selected).length;
  const isVisible = activeNodeId === id && selectedCount <= 1;

  const handleDelete = (e) => {
    e.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  const handleDuplicate = (e) => {
    e.stopPropagation();
    const node = getNodes().find((n) => n.id === id);
    if (!node) return;
    const cloned = {
      ...JSON.parse(JSON.stringify(node)),
      id: `node_${Date.now()}`,
      position: { x: node.position.x + 80, y: node.position.y + 80 },
      selected: false,
    };
    setNodes((nds) => [...nds, cloned]);
  };

  return (
    <div className={`node-floating-toolbar${isVisible ? ' is-visible' : ''}`}>
      <button className="nft-btn" onClick={handleDuplicate} title="复制节点">
        <DuplicateIcon />
      </button>
      <button className="nft-btn" onClick={handleDelete} title="删除节点">
        <DeleteIcon />
      </button>
    </div>
  );
}
