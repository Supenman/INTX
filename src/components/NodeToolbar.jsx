import { useState, useCallback, useRef, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { invoke } from '@tauri-apps/api/core';
import { useActiveNode } from '../ActiveNodeContext';
import FullscreenOverlay from './FullscreenOverlay';
import ZoomableImage from './ZoomableImage';
import CropEditor from './CropEditor';
import MattingEditor from './MattingEditor';
import GridCropEditor from './GridCropEditor';
import ModelDownloadDialog from './NodeDownloadDialog';

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

const HdIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" fill="currentColor" />
  </svg>
);

const AutoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
  </svg>
);

const MaskIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="12" cy="12" r="5" fill="currentColor" fillOpacity="0.25" />
    <path d="M7 17l2-2" />
  </svg>
);

const GridIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
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

const CameraIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
    <circle cx="12" cy="13" r="3" />
  </svg>
);

function getImageUrl(node) {
  if (!node) return null;
  return node.data?.images?.[0]?.url || node.data?.result?.url || null;
}

const MODELS = {
  upscale: 'realesrgan-x4.onnx',
  matting: 'rmbg-1.4.onnx',
};

export default function NodeToolbar({ id, type }) {
  const { activeNodeId, handleReplaceMedia, nodes: ctxNodes } = useActiveNode() || {};
  const { deleteElements, getNodes, setNodes } = useReactFlow();
  const selectedCount = getNodes().filter((n) => n.selected).length;
  const isVisible = activeNodeId === id && selectedCount <= 1;
  const isSourceImage = type === 'source-image';
  const isSourceVideo = type === 'source-video';
  const node = getNodes().find((n) => n.id === id);
  const imageUrl = getImageUrl(node);

  const [showFullscreen, setShowFullscreen] = useState(false);
  const [showCrop, setShowCrop] = useState(false);
  const [showMatting, setShowMatting] = useState(false);
  const [showCustomGrid, setShowCustomGrid] = useState(false);
  const [showGridMenu, setShowGridMenu] = useState(false);
  const [maskDataUrl, setMaskDataUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(null); // 'upscale' | 'matting' | null
  const [errorMsg, setErrorMsg] = useState(null);
  const [downloadPrompt, setDownloadPrompt] = useState(null); // shows confirm dialog
  const [downloading, setDownloading] = useState(null); // shows download progress
  const [processingPhase, setProcessingPhase] = useState(null); // shows 'processing...' overlay

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

  const handleGridCrop = useCallback(
    (side) => {
      setShowGridMenu(false);
      const currentNodes = getNodes();
      const current = currentNodes.find((n) => n.id === id);
      if (!current) return;
      const pos = current.position;
      const mw = current.measured?.width || current.width || 220;
      const mh = current.measured?.height || current.height || 200;
      const url = getImageUrl(current);
      if (!url) return;

      // Load the source image to get its natural aspect ratio
      const img = new Image();
      img.onload = () => {
        const iw = img.naturalWidth, ih = img.naturalHeight;
        // Scale the storyboard height to match the image aspect ratio at the source width
        const aspectH = Math.round(mw * (ih / iw));
        setNodes((nds) => [...nds, {
          id: `node_${Date.now()}`,
          type: 'storyboard',
          position: { x: pos.x + mw + 60, y: pos.y },
          width: Math.round(mw), height: Math.max(aspectH, 60),
          selected: false,
          data: { imageUrl: url, gridRows: side, gridCols: side, title: `${side * side}宫格` },
        }]);
      };
      img.onerror = () => {
        // Fallback: use source node dimensions
        setNodes((nds) => [...nds, {
          id: `node_${Date.now()}`,
          type: 'storyboard',
          position: { x: pos.x + mw + 60, y: pos.y },
          width: Math.round(mw), height: Math.round(mh),
          selected: false,
          data: { imageUrl: url, gridRows: side, gridCols: side, title: `${side * side}宫格` },
        }]);
      };
      img.src = url;
    },
    [getNodes, setNodes, id],
  );

  const handleCustomGridConfirm = useCallback(
    (hPcts, vPcts) => {
      setShowCustomGrid(false);
      const currentNodes = getNodes();
      const current = currentNodes.find((n) => n.id === id);
      if (!current) return;
      const pos = current.position;
      const mw = current.measured?.width || current.width || 220;
      const url = getImageUrl(current);
      if (!url) return;
      const rows = hPcts.length + 1;
      const cols = vPcts.length + 1;
      const img = new Image();
      img.onload = () => {
        const iw = img.naturalWidth, ih = img.naturalHeight;
        const aspectH = Math.round(mw * (ih / iw));
        setNodes((nds) => [...nds, {
          id: `node_${Date.now()}`,
          type: 'storyboard',
          position: { x: pos.x + mw + 60, y: pos.y },
          width: Math.round(mw), height: Math.max(aspectH, 60),
          selected: false,
          data: { imageUrl: url, gridRows: rows, gridCols: cols, rowPositions: hPcts, colPositions: vPcts, title: `自定义 ${rows}×${cols}` },
        }]);
      };
      img.onerror = () => {
        setNodes((nds) => [...nds, {
          id: `node_${Date.now()}`,
          type: 'storyboard',
          position: { x: pos.x + mw + 60, y: pos.y },
          width: Math.round(mw), height: 200,
          selected: false,
          data: { imageUrl: url, gridRows: rows, gridCols: cols, rowPositions: hPcts, colPositions: vPcts, title: `自定义 ${rows}×${cols}` },
        }]);
      };
      img.src = url;
    },
    [getNodes, setNodes, id],
  );

  const gridMenuRef = useRef(null);
  useEffect(() => {
    if (!showGridMenu) return;
    const handler = (e) => {
      if (gridMenuRef.current && !gridMenuRef.current.contains(e.target)) setShowGridMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showGridMenu]);

  const saveDataUrlToNode = useCallback(
    (resultUrl, label) => {
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
          images: [{ url: resultUrl, name: (current.data?.title || 'image') + ' ' + label, type: 'image' }],
        },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [getNodes, setNodes, id],
  );

  const handleUpscale = useCallback(
    async (e) => {
      e.stopPropagation();
      if (isProcessing || !imageUrl) return;
      setIsProcessing('upscale');
      setErrorMsg(null);
      try {
        // Check model cached — if not, show download prompt
        const cached = await invoke('check_model_exists', { modelName: MODELS.upscale }).catch(() => false);
        if (!cached) {
          setIsProcessing(null);
          setDownloadPrompt('upscale');
          return;
        }
        const resultDataUrl = await invoke('upscale_image', { path: imageUrl });
        saveDataUrlToNode(resultDataUrl, '高清');
      } catch (err) {
        console.error('Upscale failed:', err);
        setErrorMsg('超分失败: ' + (err?.message || err || '未知错误'));
      } finally {
        setIsProcessing(null);
      }
    },
    [isProcessing, imageUrl, id, saveDataUrlToNode],
  );

  const handleMatting = useCallback(
    async (e) => {
      e.stopPropagation();
      if (isProcessing || !imageUrl) return;
      setIsProcessing('matting');
      setErrorMsg(null);
      try {
        const cached = await invoke('check_model_exists', { modelName: MODELS.matting }).catch(() => false);
        if (!cached) {
          setIsProcessing(null);
          setDownloadPrompt('matting');
          return;
        }
        const resultDataUrl = await invoke('matting_image', { path: imageUrl });
        saveDataUrlToNode(resultDataUrl, '主体');
      } catch (err) {
        console.error('Matting failed:', err);
        setErrorMsg('抠图失败: ' + (err?.message || err || '未知错误'));
      } finally {
        setIsProcessing(null);
      }
    },
    [isProcessing, imageUrl, id, saveDataUrlToNode],
  );

  const handleCaptureFrame = useCallback(
    (e) => {
      e.stopPropagation();
      const currentNodes = getNodes();
      const current = currentNodes.find((n) => n.id === id);
      if (!current) return;
      const videoUrl = current.data?.result?.url || current.data?.images?.[0]?.url;
      if (!videoUrl) return;
      // Find the video element in the DOM
      const nodeEl = document.querySelector(`.react-flow__node[data-id="${id}"]`);
      const videoEl = nodeEl?.querySelector?.('video');
      if (!videoEl) return;
      const canvas = document.createElement('canvas');
      canvas.width = videoEl.videoWidth || videoEl.clientWidth;
      canvas.height = videoEl.videoHeight || videoEl.clientHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      const pos = current.position;
      const mw = current.measured?.width || current.width || 280;
      setNodes((nds) => [...nds, {
        id: `node_${Date.now()}`,
        type: 'source-image',
        position: { x: pos.x + mw + 40, y: pos.y },
        selected: false,
        data: { images: [{ url: dataUrl, name: '截取帧', type: 'image' }], result: { type: 'image', url: dataUrl } },
      }]);
    },
    [getNodes, setNodes, id],
  );

  const handleDownloadConfirm = useCallback(async () => {
    const type = downloadPrompt;
    setDownloadPrompt(null);
    setDownloading(type);
    setErrorMsg(null);
    try {
      if (type === 'upscale') {
        const resultDataUrl = await invoke('upscale_image', { path: imageUrl });
        saveDataUrlToNode(resultDataUrl, '高清');
      } else if (type === 'matting') {
        const resultDataUrl = await invoke('matting_image', { path: imageUrl });
        saveDataUrlToNode(resultDataUrl, '主体');
      }
    } catch (err) {
      console.error(type + ' failed:', err);
      setErrorMsg((type === 'upscale' ? '超分' : '抠图') + '失败: ' + (err?.message || err || '未知错误'));
    } finally {
      setDownloading(null);
    }
  }, [downloadPrompt, imageUrl, id, saveDataUrlToNode]);

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
            <div style={{ position: 'relative', display: 'inline-flex' }} ref={gridMenuRef}>
              <button className="nft-btn" onClick={() => setShowGridMenu((v) => !v)} title="宫格裁切">
                <GridIcon />
              </button>
              {showGridMenu && (
                <div style={{
                  position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
                  zIndex: 200, background: 'var(--panel-bg-strong)', backdropFilter: 'var(--panel-blur)',
                  border: '1px solid var(--sidebar-border)', borderRadius: 8, padding: 4, boxShadow: 'var(--panel-shadow)',
                  display: 'flex', flexDirection: 'column', gap: 2, minWidth: 100,
                }}>
                  <div style={{ padding: '5px 8px 3px', fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}>选择宫格</div>
                  {[
                    { label: '4宫格', size: 2 },
                    { label: '9宫格', size: 3 },
                    { label: '16宫格', size: 4 },
                    { label: '25宫格', size: 5 },
                  ].map(({ label, size }) => (
                    <button key={size} onClick={() => handleGridCrop(size)}
                      style={{ padding: '5px 10px', border: 'none', borderRadius: 5, background: 'transparent', color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--sidebar-item-bg-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      {label}
                    </button>
                  ))}
                  <div style={{ height: 1, background: 'var(--sidebar-border)', margin: '3px 8px' }} />
                  <button onClick={() => { setShowGridMenu(false); setShowCustomGrid(true); }}
                    style={{ padding: '5px 10px', border: 'none', borderRadius: 5, background: 'transparent', color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--sidebar-item-bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    自定义裁切
                  </button>
                </div>
              )}
            </div>
            {!imageUrl.startsWith('blob:') && (
              <button className="nft-btn" onClick={handleDownload} title="下载">
                <DownloadIcon />
              </button>
            )}
            <button className="nft-btn" onClick={handleUpscale} title={isProcessing === 'upscale' ? '超分处理中...' : '高清超分'} disabled={isProcessing !== null}>
              <HdIcon />
            </button>
            <button className="nft-btn" onClick={handleMatting} title={isProcessing === 'matting' ? '主体识别中...' : '自动识别主体'} disabled={isProcessing !== null}>
              <AutoIcon />
            </button>
            <button className="nft-btn" onClick={() => setShowMatting(true)} title="遮罩编辑">
              <MaskIcon />
            </button>
            <div className="nft-divider" />
          </>
        )}
        {isSourceVideo && (
          <>
            <button className="nft-btn" onClick={handleCaptureFrame} title="截取当前帧">
              <CameraIcon />
            </button>
            <button className="nft-btn" onClick={handleReplace} title="替换视频">
              <ReplaceIcon />
            </button>
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
      {errorMsg && (
        <div className="nft-error" onClick={() => setErrorMsg(null)}>
          {errorMsg}
        </div>
      )}
      {downloadPrompt && (
        <ModelDownloadDialog
          type={downloadPrompt}
          showPrompt={true}
          showDownloading={false}
          onConfirm={handleDownloadConfirm}
          onCancel={() => setDownloadPrompt(null)}
        />
      )}
      {downloading && (
        <ModelDownloadDialog
          type={downloading}
          showPrompt={false}
          showDownloading={true}
          showProcessing={false}
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      )}
      {isProcessing && !downloading && (
        <ModelDownloadDialog
          type={isProcessing}
          showPrompt={false}
          showDownloading={false}
          showProcessing={true}
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      )}
      <FullscreenOverlay isOpen={showFullscreen} onClose={() => setShowFullscreen(false)}>
        <ZoomableImage src={imageUrl} alt="预览" />
      </FullscreenOverlay>
      <CropEditor isOpen={showCrop} imageUrl={imageUrl} onClose={() => setShowCrop(false)} onSave={handleCropSave} />
      <MattingEditor isOpen={showMatting} imageUrl={imageUrl} onClose={() => setShowMatting(false)} onSave={(maskUrl) => { setMaskDataUrl(maskUrl); setShowMatting(false); }} />
      <GridCropEditor isOpen={showCustomGrid} imageUrl={imageUrl} onClose={() => setShowCustomGrid(false)} onSave={handleCustomGridConfirm} />
    </>
  );
}
