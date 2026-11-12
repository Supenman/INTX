import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LegacyReport } from '@/domain';
import {
  applyLegacy,
  previewLegacy,
  readLegacyFile,
  scanLegacySources,
  type LegacySource,
} from '@/app/useCases/legacyImport';
import { PanelMask } from '@/ui/common/PanelMask';

interface Props {
  onClose: () => void;
  onImported: (message: string) => void;
}

/**
 * 旧版数据导入对话框。
 *
 * 刻意做成「先预览再确认」：旧 data 是开放字典，迁移必然丢东西，
 * 把丢什么、为什么丢摊开给用户看，比导入完弹一句"完成"诚实得多。
 * 复用了设置面板的 panel-mask / two-col / list-item 样式。
 */
export function LegacyImportDialog({ onClose, onImported }: Props) {
  const [sources, setSources] = useState<LegacySource[]>([]);
  const [fileSource, setFileSource] = useState<LegacySource | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let found: LegacySource[] = [];
    try {
      found = scanLegacySources(window.localStorage);
    } catch {
      found = []; // localStorage 被禁用时当作没有旧数据
    }
    setSources(found);
    if (found[0]) setSelectedId(found[0].id);
  }, []);

  const all = useMemo(
    () => [...sources, ...(fileSource ? [fileSource] : [])],
    [sources, fileSource],
  );
  const selected = all.find((s) => s.id === selectedId) ?? null;
  const preview = useMemo(() => (selected ? previewLegacy(selected) : null), [selected]);

  const chooseFile = useCallback(async () => {
    const src = await readLegacyFile();
    if (!src) return;
    setFileSource(src);
    setSelectedId(src.id);
    setError(null);
  }, []);

  const doImport = useCallback(async () => {
    if (!selected || !preview?.ok || busy) return;
    if (!window.confirm(`导入「${selected.label}」会替换当前画布（资产库保留）。继续吗？`)) return;
    setBusy(true);
    const result = await applyLegacy(selected);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onImported(result.message);
    onClose();
  }, [selected, preview, busy, onImported, onClose]);

  const report: LegacyReport | null = preview?.ok ? preview.report : null;

  return (
    <PanelMask onClose={onClose}>
      <div className="panel legacy-dialog" role="dialog" aria-label="导入旧版数据">
        <div className="panel-head">
          <h2>导入旧版 BeastTV / INTX 数据</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭" title="关闭 (Esc)">
            ×
          </button>
        </div>

        <div className="panel-body two-col">
          <div className="panel-list">
            {all.length === 0 && (
              <p className="legacy-empty">本机 localStorage 里没找到旧数据，可以从 JSON 文件导入。</p>
            )}
            {all.map((s) => (
              <button
                key={s.id}
                className={`list-item legacy-source ${selectedId === s.id ? 'active' : ''}`}
                onClick={() => {
                  setSelectedId(s.id);
                  setError(null);
                }}
              >
                <span>{s.label}</span>
                <small>{s.detail}</small>
              </button>
            ))}
            <button className="list-item add" onClick={() => void chooseFile()}>
              ＋ 选择旧 JSON 文件
            </button>
          </div>

          <div className="panel-form legacy-report">
            {!selected && <p className="legacy-empty">选一个来源查看迁移预览。</p>}

            {selected && preview && !preview.ok && (
              <div className="legacy-error">{preview.message}</div>
            )}

            {selected && report && (
              <>
                <div className="legacy-stats">
                  <span>节点 <b>{report.nodeCount}</b></span>
                  <span>连线 <b>{report.edgeCount}</b></span>
                  <span>已映射 <b>{report.mappedNodes}</b></span>
                  <span className={report.fallbackNodes > 0 ? 'warn' : ''}>
                    占位 <b>{report.fallbackNodes}</b>
                  </span>
                  <span className={report.droppedEdges > 0 ? 'warn' : ''}>
                    丢弃连线 <b>{report.droppedEdges}</b>
                  </span>
                </div>

                <h4>迁移说明</h4>
                <div className="legacy-notes">
                  {report.notes.map((n, i) => (
                    <div key={i} className={`legacy-note ${n.level}`}>
                      {n.message}
                    </div>
                  ))}
                </div>

                {report.droppedEdgeReasons.length > 0 && (
                  <>
                    <h4>未迁移的连线</h4>
                    <div className="legacy-reasons">
                      {report.droppedEdgeReasons.map((r, i) => (
                        <div key={i}>{r}</div>
                      ))}
                    </div>
                  </>
                )}

                {report.ignoredFields.length > 0 && (
                  <p className="legacy-fields">
                    未迁移字段：<code>{report.ignoredFields.join('、')}</code>
                  </p>
                )}
              </>
            )}

            {error && <div className="legacy-error">{error}</div>}
          </div>
        </div>

        <div className="legacy-foot">
          <span>只读扫描，不会删除旧数据；导入会替换当前画布，资产库保留。</span>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary legacy-apply"
            disabled={!preview?.ok || busy}
            onClick={() => void doImport()}
          >
            {busy ? '导入中…' : '导入到画布'}
          </button>
        </div>
      </div>
    </PanelMask>
  );
}
