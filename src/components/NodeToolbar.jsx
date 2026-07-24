import { useState, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useActiveNode } from '../ActiveNodeContext';
import FullscreenOverlay from './FullscreenOverlay';
import ZoomableImage from './ZoomableImage';
import CropEditor from './CropEditor';

const FullscreenIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  </svg>
);

const ReplaceIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const CropIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2" />
  </svg>
);

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

function getImageUrl(node) {
  if (!node) return null;
  return node.data?.images?.[0]?.url || node.data?.result?.url || null;
}

export default function NodeToolbar({ id, type }) {
  const { activeNodeId, handleReplaceMedia, nodes: ctxNodes } = useActiveNode() || {};
  const { deleteElements, getNodes, setNodes } = useReactFlow();
  const selectedCount = getNodes().filter((n) => n.selected).length;
  const isVisible = activeNodeId === id && selectedCount <= 1;
  const isSourceImage = type === 'source-image';
  const node = getNodes().find((n) => n.id === id);
  const imageUrl = getImageUrl(node);

  const [showFullscreen, setShowFullscreen] = useState(false);
  const [showCrop, setShowCrop] = useState(false);

  const handleDelete = useCallback((e) => {
    e.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  }, [deleteElements, id]);

  const handleDuplicate = useCallback((e) => {
    e.stopPropagation();
    const n = getNodes().find((nd) => nd.id === id);
    if (!n) return;
    const cloned = {
      ...JSON.parse(JSON.stringify(n)),
      id: `node_${Date.now()}`,
      position: { x: n.position.x + 80, y: n.position.y + 80 },
      selected: false,
    };
    setNodes((nds) => [...nds, cloned]);
  }, [getNodes, setNodes, id]);

  const handleDownload = useCallback((e) => {
    e.stopPropagation();
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = node?.data?.title || 'image';
    a.click();
  }, [imageUrl, node]);

  const handleReplace = useCallback((e) => {
    e.stopPropagation();
    handleReplaceMedia?.(id);
  }, [handleReplaceMedia, id]);

  const handleCropSave = useCallback(
    (dataUrl, metadata) => {
      const now = Date.now();
      const currentNodes = getNodes();
      const current = currentNodes.find((n) => n.id === id);
      if (!current) return;
      const pos = current.position;
      const newNode = {
        ...JSON.parse(JSON.stringify(current)),
        id: `node_${now}`,
        position: { x: pos.x + (current.measured?.width || 220) + 40, y: pos.y },
        selected: false,
        data: {
          ...JSON.parse(JSON.stringify(current.data)),
          images: [{ url: dataUrl, name: (current.data?.title || 'image') + ' 裁切', type: 'image' }],
          result: { type: 'image', url: dataUrl, width: metadata?.width, height: metadata?.height },
        },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [getNodes, setNodes, id],
  );

  return (
    <>
      <div className={`node-floating-toolbar${isVisible ? ' is-visible' : ''}`}>
        {isSourceImage && imageUrl && (
          <>
            <button className="nft-btn" onClick={() => setShowFullscreen(true)} title="全屏预览">
              <FullscreenIcon />
            </button>
            <button className="nft-btn" onClick={handleReplace} title="替换图片">
              <ReplaceIcon />
            </button>
            <button className="nft-btn" onClick={() => setShowCrop(true)} title="裁切">
              <CropIcon />
            </button>
            {!imageUrl.startsWith('blob:') && (
              <button className="nft-btn" onClick={handleDownload} title="下载">
                <DownloadIcon />
              </button>
            )}
            <div className="nft-divider" />
          </>
        )}
        <button className="nft-btn" onClick={handleDuplicate} title="复制节点">
          <DuplicateIcon />
        </button>
        <button className="nft-btn" onClick={handleDelete} title="删除节点">
          <DeleteIcon />
        </button>
      </div>
      <FullscreenOverlay isOpen={showFullscreen} onClose={() => setShowFullscreen(false)}>
        <ZoomableImage src={imageUrl} alt="预览" />
      </FullscreenOverlay>
      <CropEditor isOpen={showCrop} imageUrl={imageUrl} onClose={() => setShowCrop(false)} onSave={handleCropSave} />
    </>
  );
}
