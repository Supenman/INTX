import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ASPECT_PRESETS,
  aspectValue,
  cropFromDrag,
  fitAspect,
  UPSCALE_SCALES,
  type AspectId,
  type CropRect,
  type NormalizedPoint,
  type UpscaleScale,
} from '@/domain';
import type { AssetEntry } from '@/app/stores/assetStore';
import { resolveRuntime } from '@/infra/runtime';
import { decodeImage } from '@/infra/imaging/canvas';
import { probeUpscalers } from '@/infra/upscale';
import { saveCrop, saveMask, type MaskStroke } from '@/app/useCases/materialEdit';
import { upscaleAsset } from '@/app/useCases/upscaleAsset';
import { downloadBlob } from '@/ui/common/download';

/**
 * 素材编辑器：裁切 + 遮罩 + 放大。
 *
 * canvas 只负责「按显示尺寸画出来给人看」，导出时 app 层会按**原图像素**
 * 重新绘制一遍。所有交互坐标都是归一化的，缩放显示不会让裁切框跑偏。
 *
 * 放大这一栏特意把后端探测结果摊开给用户：正式路线是 Tauri 本地 ONNX，
 * 条件不具备时自动回退到参考重采样。不把插值放大冒充 AI 超分。
 */

type Mode = 'crop' | 'mask' | 'upscale';

const MAX_W = 660;
const MAX_H = 430;

interface BackendInfo {
  label: string;
  ai: boolean;
  fallback: boolean;
  ready: boolean;
  missing: { label: string; message: string; hint?: string }[];
}

const PROBING: BackendInfo = { label: '探测中…', ai: false, fallback: false, ready: false, missing: [] };

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function MaterialEditor({ entry, onClose }: { entry: AssetEntry; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>('crop');
  const [aspect, setAspect] = useState<AspectId>('free');
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 1, height: 1 });
  const [dragStart, setDragStart] = useState<NormalizedPoint | null>(null);
  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  const [brush, setBrush] = useState(0.03);
  const [upscaleScale, setUpscaleScale] = useState<UpscaleScale>(2);
  const [backend, setBackend] = useState<BackendInfo>(PROBING);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const runtime = await resolveRuntime();
        const bytes = await runtime.blobs.get(entry.blobKey);
        if (!bytes) {
          if (!cancelled) setLoadError('原图文件丢失了');
          return;
        }
        const decoded = await decodeImage(bytes, entry.asset.mime);
        if (cancelled) return;
        setImg(decoded);
        setSize({ width: decoded.naturalWidth, height: decoded.naturalHeight });
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : '原图载入失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.blobKey, entry.asset.mime]);

  // 后端能力是异步探测的（Tauri / 模型文件），打开编辑器就查一次。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const probes = await probeUpscalers();
      if (cancelled) return;
      const index = probes.findIndex((p) => p.availability.ok);
      const active = index >= 0 ? probes[index]!.adapter : null;
      const missing = probes.flatMap((p) =>
        p.availability.ok
          ? []
          : [
              {
                label: p.adapter.label,
                message: p.availability.missing.message,
                hint: p.availability.missing.hint,
              },
            ],
      );
      setBackend({
        label: active?.label ?? '没有可用的放大后端',
        ai: active?.ai ?? false,
        fallback: index > 0,
        ready: active !== null,
        missing,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const display = useMemo(() => {
    if (!size.width || !size.height) return { width: 0, height: 0 };
    const scale = Math.min(MAX_W / size.width, MAX_H / size.height, 1);
    return {
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
    };
  }, [size]);

  // 每次状态变化整体重绘。图层只有一层，但比维护多个 canvas 的同步简单得多。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img || display.width === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = display.width;
    const H = display.height;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);

    if (mode === 'crop') {
      const x = crop.x * W;
      const y = crop.y * H;
      const w = crop.width * W;
      const h = crop.height * H;
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(x, y, w, h);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#ff6b35';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2));
      ctx.fillStyle = '#ff6b35';
      const corners = [
        { x, y },
        { x: x + w, y },
        { x, y: y + h },
        { x: x + w, y: y + h },
      ];
      for (const c of corners) ctx.fillRect(c.x - 3, c.y - 3, 6, 6);
    } else if (mode === 'mask') {
      ctx.strokeStyle = 'rgba(255,107,53,0.9)';
      ctx.fillStyle = 'rgba(255,107,53,0.9)';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const stroke of strokes) {
        const radius = Math.max(2, stroke.radius * W);
        ctx.lineWidth = radius * 2;
        const first = stroke.points[0];
        if (!first) continue;
        if (stroke.points.length === 1) {
          ctx.beginPath();
          ctx.arc(first.x * W, first.y * H, radius, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.beginPath();
        ctx.moveTo(first.x * W, first.y * H);
        for (let i = 1; i < stroke.points.length; i += 1) {
          const pt = stroke.points[i]!;
          ctx.lineTo(pt.x * W, pt.y * H);
        }
        ctx.stroke();
      }
    }
    // upscale 模式：只显示原图，不叠加任何取景框或笔迹
  }, [img, display.width, display.height, mode, crop, strokes]);

  const pointAt = (ev: ReactPointerEvent<HTMLCanvasElement>): NormalizedPoint | null => {
    const rect = ev.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp01((ev.clientX - rect.left) / rect.width),
      y: clamp01((ev.clientY - rect.top) / rect.height),
    };
  };

  const onPointerDown = (ev: ReactPointerEvent<HTMLCanvasElement>) => {
    if (mode === 'upscale') return;
    const pt = pointAt(ev);
    if (!pt) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    setFeedback(null);
    if (mode === 'crop') {
      setDragStart(pt);
      setCrop(cropFromDrag(pt, pt, aspectValue(aspect), size.width, size.height));
    } else {
      setStrokes((prev) => [...prev, { points: [pt], radius: brush }]);
    }
  };

  const onPointerMove = (ev: ReactPointerEvent<HTMLCanvasElement>) => {
    if (mode === 'upscale') return;
    const pt = pointAt(ev);
    if (!pt) return;
    if (mode === 'crop') {
      if (!dragStart) return;
      setCrop(cropFromDrag(dragStart, pt, aspectValue(aspect), size.width, size.height));
    } else {
      setStrokes((prev) => {
        const last = prev[prev.length - 1];
        if (!last) return prev;
        const next = [...prev];
        next[next.length - 1] = { ...last, points: [...last.points, pt] };
        return next;
      });
    }
  };

  const onPointerUp = () => setDragStart(null);

  const changeAspect = (id: AspectId) => {
    setAspect(id);
    setCrop(fitAspect(crop, aspectValue(id), size.width, size.height));
  };

  const run = async () => {
    if (!img) return;
    setBusy(true);
    setFeedback(null);

    if (mode === 'upscale') {
      const r = await upscaleAsset(entry.asset.id, upscaleScale);
      setBusy(false);
      if (!r.ok) {
        setFeedback(`✕ ${r.message}${r.hint ? ` · ${r.hint}` : ''}`);
        return;
      }
      downloadBlob(r.blob, r.filename);
      setFeedback(
        `已存入资产库 · ${r.width}×${r.height} · ${r.backendLabel}` +
          `${r.reused ? ' · 内容已存在，复用字节' : ''} · ${r.elapsedMs}ms`,
      );
      return;
    }

    const r = mode === 'crop' ? await saveCrop(entry.asset.id, crop) : await saveMask(entry.asset.id, strokes);
    setBusy(false);
    if (!r.ok) {
      setFeedback('✕ ' + r.message);
      return;
    }
    downloadBlob(r.blob, r.filename);
    setFeedback(`已存入资产库 · ${r.width}×${r.height}${r.reused ? ' · 内容已存在，复用字节' : ''}`);
  };

  const primaryLabel = busy
    ? mode === 'upscale'
      ? '放大中…'
      : '处理中…'
    : mode === 'crop'
      ? '另存为新素材'
      : mode === 'mask'
        ? '导出蒙版'
        : `放大 ${upscaleScale}× 并存为新素材`;

  return (
    <div className="panel-mask" onClick={onClose}>
      <div className="material-editor" onClick={(ev) => ev.stopPropagation()}>
        <header className="material-head">
          <strong>素材编辑</strong>
          <span className="mono small">{size.width ? `${size.width}×${size.height}` : '…'}</span>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="material-tabs">
          <button className={mode === 'crop' ? 'active' : ''} onClick={() => setMode('crop')}>
            裁切
          </button>
          <button className={mode === 'mask' ? 'active' : ''} onClick={() => setMode('mask')}>
            遮罩（局部重绘用）
          </button>
          <button className={mode === 'upscale' ? 'active' : ''} onClick={() => setMode('upscale')}>
            放大 / 超分
          </button>
        </div>

        <div className="material-tools">
          {mode === 'crop' && (
            <>
              <span className="muted small">比例</span>
              {ASPECT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`material-aspect chip ${aspect === p.id ? 'accent' : ''}`}
                  data-aspect={p.id}
                  onClick={() => changeAspect(p.id)}
                >
                  {p.label}
                </button>
              ))}
              <span className="muted small material-hint">在图上拖出取景框</span>
            </>
          )}
          {mode === 'mask' && (
            <>
              <span className="muted small">笔刷</span>
              <input
                className="material-brush"
                type="range"
                min={0.005}
                max={0.08}
                step={0.005}
                value={brush}
                onChange={(ev) => setBrush(Number(ev.target.value))}
                aria-label="笔刷大小"
              />
              <span className="mono small">{strokes.length} 笔</span>
              <button className="btn ghost small" onClick={() => setStrokes([])}>
                清空笔迹
              </button>
              <span className="muted small material-hint">导出黑白蒙版，尺寸与原图一致</span>
            </>
          )}
          {mode === 'upscale' && (
            <>
              <span className="muted small">倍率</span>
              {UPSCALE_SCALES.map((s) => (
                <button
                  key={s}
                  className={`upscale-scale chip ${upscaleScale === s ? 'accent' : ''}`}
                  data-scale={s}
                  onClick={() => setUpscaleScale(s)}
                >
                  {s}×
                </button>
              ))}
              <span className="muted small material-hint">整图放大，产物入资产库</span>
            </>
          )}
        </div>

        {mode === 'upscale' && (
          <div className="upscale-panel">
            <div className="upscale-backend">
              <span className="muted small">当前后端</span>
              <strong>{backend.label}</strong>
              <span className={`chip ${backend.ai ? '' : 'warn'}`}>
                {backend.ai ? 'AI 超分' : '演示级 · 非 AI'}
              </span>
              {backend.fallback && <span className="muted small">已自动回退</span>}
            </div>
            <p className="muted small">
              正式路线是 <b>Tauri 本地 ONNX</b>（桌面优先，不引入服务端）。模型与推理都留在本机；
              当前环境不具备条件时回退到参考重采样，用来跑通闭环，产物同样按内容哈希入库。
            </p>
            {backend.missing.length > 0 && (
              <ul className="upscale-missing">
                {backend.missing.map((m) => (
                  <li key={m.label}>
                    <b>{m.label}</b> · {m.message}
                    {m.hint && <span className="muted"> — {m.hint}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="material-stage">
          {loadError ? (
            <span className="muted">{loadError}</span>
          ) : img ? (
            <canvas
              ref={canvasRef}
              className="material-canvas"
              width={display.width}
              height={display.height}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          ) : (
            <span className="muted">载入中…</span>
          )}
        </div>

        <div className="material-foot">
          <span className={`material-feedback ${feedback?.startsWith('✕') ? 'bad' : ''}`}>{feedback}</span>
          <button className="btn ghost small" onClick={onClose}>
            关闭
          </button>
          <button
            className="btn small material-primary"
            disabled={busy || !img || (mode === 'upscale' && !backend.ready)}
            onClick={() => void run()}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
