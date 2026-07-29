import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

const MESSAGES = {
  upscale: {
    title: '下载超分模型',
    description: 'Real-ESRGAN 模型文件（约 67MB）将下载到本地用于图像高清处理。',
    downloading: '正在下载超分模型...',
    processing: '正在超分处理中...',
  },
  matting: {
    title: '下载主体识别模型',
    description: 'RMBG-1.4 模型文件（约 176MB）将下载到本地用于背景去除。',
    downloading: '正在下载抠图模型...',
    processing: '正在识别主体中...',
  },
};

export default function ModelDownloadDialog({ type, showPrompt, showDownloading, showProcessing, progress, onConfirm, onCancel }) {
  const [localProgress, setLocalProgress] = useState({ received: 0, total: 0 });
  const [inferProgress, setInferProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    if (!showDownloading) return;
    let unlisten;
    (async () => {
      try {
        unlisten = await listen('model-download-progress', (e) => {
          setLocalProgress({
            received: e.payload.received || 0,
            total: e.payload.total || 0,
          });
        });
      } catch (e) { /* not in tauri */ }
    })();
    return () => { if (unlisten) unlisten(); };
  }, [showDownloading]);

  useEffect(() => {
    if (!showProcessing) return;
    let unlisten;
    (async () => {
      try {
        unlisten = await listen('model-progress', (e) => {
          setInferProgress({
            current: e.payload.current || 0,
            total: e.payload.total || 0,
          });
        });
      } catch (e) { /* not in tauri */ }
    })();
    return () => { if (unlisten) unlisten(); };
  }, [showProcessing]);

  const pct = localProgress.total > 0
    ? Math.round((localProgress.received / localProgress.total) * 100)
    : 0;
  const showPct = localProgress.total > 0;

  const inferPct = inferProgress.total > 0
    ? Math.round((inferProgress.current / inferProgress.total) * 100)
    : 0;

  if (showPrompt) {
    const m = MESSAGES[type];
    return (
      <div className="mdd-overlay" onClick={onCancel}>
        <div className="mdd-prompt" onClick={(e) => e.stopPropagation()}>
          <div className="mdd-prompt-title">{m.title}</div>
          <div className="mdd-prompt-desc">{m.description}</div>
          <div className="mdd-prompt-actions">
            <button className="mdd-btn mdd-btn-secondary" onClick={onCancel}>取消</button>
            <button className="mdd-btn mdd-btn-primary" onClick={onConfirm}>下载模型</button>
          </div>
        </div>
      </div>
    );
  }

  if (showDownloading) {
    const m = MESSAGES[type];
    return (
      <div className="mdd-overlay">
        <div className="mdd-downloading">
          <div className="mdd-spinner" />
          <div className="mdd-downloading-text">{m.downloading}</div>
          {showPct && (
            <div className="mdd-progress-wrap">
              <div className="mdd-progress-bar" style={{ width: pct + '%' }} />
            </div>
          )}
          {showPct && <div className="mdd-progress-pct">{pct}%</div>}
        </div>
      </div>
    );
  }

  if (showProcessing) {
    const m = MESSAGES[type];
    const showInferBar = inferProgress.total > 0;
    return (
      <div className="mdd-overlay">
        <div className="mdd-downloading">
          <div className="mdd-spinner" />
          <div className="mdd-downloading-text">{m.processing}</div>
          {showInferBar && (
            <>
              <div className="mdd-progress-wrap">
                <div className="mdd-progress-bar" style={{ width: inferPct + '%' }} />
              </div>
              <div className="mdd-progress-pct">{inferPct}% ({inferProgress.current}/{inferProgress.total})</div>
            </>
          )}
        </div>
      </div>
    );
  }

  return null;
}
