import { useEffect, useMemo, useState } from 'react';
import {
  auditToCsv,
  buildAuditEntries,
  filterAudit,
  parseRepro,
  summarizeAudit,
  type AuditEntry,
  type AuditFilter,
  type Task,
  type TaskKind,
  type TaskStatus,
} from '@/domain';
import { foldEvents } from '@/infra/repository/taskLog';
import { resolveRuntime } from '@/infra/runtime';
import { useProviderStore } from '@/app/stores/providerStore';
import { exportReproForTask } from '@/app/useCases/reproExport';
import { runReproPackage } from '@/app/useCases/reproRunner';
import { pickFile } from '@/app/useCases/projectPackage';
import { downloadBytes } from '@/ui/common/download';

/**
 * 审计台账面板。
 *
 * 数据来自任务日志（tasks.jsonl / IndexedDB）的完整折叠结果，不限于当前会话加载的任务。
 * 展示：谁、何时、哪家厂商（是否出境）、出了什么、花多少、成功与否；
 * 并能按厂商/状态/出境筛选、汇总、导出 CSV、以及一键导出/导入复现包。
 */

interface Props {
  onClose: () => void;
  onError: (msg: string) => void;
  onFlash: (msg: string) => void;
}

export function AuditPanel({ onClose, onError, onFlash }: Props) {
  const configs = useProviderStore((s) => s.configs);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<AuditFilter>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const runtime = await resolveRuntime();
      const events = await runtime.tasks.readEvents();
      if (!cancelled) setTasks(foldEvents(events));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 依赖必须带 configs。
   *
   * 踩坑记录：最初只写 [tasks]，是因为觉得「configs 用 getState() 取最新就不算依赖」。
   * 但 useMemo 只有在依赖变化时才重算——用户在设置里把某厂商改成「内部」后不重开面板，
   * 台账里的「出境」标记会一直是旧的。getState() 绕过了 React 的依赖追踪，
   * eslint 的 exhaustive-deps 也看不到（它只认变量引用），于是 lint 全绿、逻辑是错的。
   */
  const entries = useMemo(() => buildAuditEntries(tasks, configs), [tasks, configs]);
  const filtered = useMemo(() => filterAudit(entries, filter), [entries, filter]);
  const summary = useMemo(() => summarizeAudit(filtered), [filtered]);

  function apply<K extends keyof AuditFilter>(key: K, value: AuditFilter[K]) {
    setFilter((f) => {
      const next = { ...f };
      if (value === undefined || value === '' || value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function exportCsv() {
    const csv = auditToCsv(filtered);
    downloadBytes(new TextEncoder().encode(csv).buffer, 'text/csv;charset=utf-8', 'intx-audit.csv');
  }

  async function exportRepro(taskId: string) {
    setBusy(taskId);
    const err = await exportReproForTask(taskId);
    setBusy(null);
    if (err) onError(err);
    else onFlash('复现包已导出');
  }

  async function importRepro() {
    const file = await pickFile();
    if (!file) return;
    const parsed = parseRepro(await file.text());
    if (!parsed.ok) {
      onError(`复现包无效：${parsed.error.message}`);
      return;
    }
    setBusy('import');
    const r = await runReproPackage(parsed.value);
    setBusy(null);
    if (r.ok) onFlash('复现已完成，新节点已生成');
    else if (r.message) onError(r.message);
  }

  return (
    <div className="panel-mask" onClick={onClose}>
      <div className="panel wide" onClick={(e) => e.stopPropagation()}>
        <header className="panel-head">
          <h2>审计台账</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="panel-body audit">
          <div className="audit-summary">
            <span className="chip">总 <b>{summary.total}</b></span>
            <span className="chip ok">成功 <b>{summary.succeeded}</b></span>
            <span className="chip danger">失败 <b>{summary.failed}</b></span>
            <span className="chip warn">出境 <b>{summary.egressCount}</b></span>
            <span className="chip">产物 <b>{summary.resultCount}</b></span>
            <span className="chip">
              成本{' '}
              <b>
                {summary.costByCurrency.length === 0
                  ? '—'
                  : summary.costByCurrency.map((c) => `${c.amount} ${c.currency}`).join(' + ')}
              </b>
            </span>
          </div>

          <div className="audit-filters">
            <select value={filter.providerId ?? ''} onChange={(e) => apply('providerId', e.target.value || undefined)}>
              <option value="">全部厂商</option>
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select value={filter.status ?? ''} onChange={(e) => apply('status', (e.target.value || undefined) as TaskStatus | undefined)}>
              <option value="">全部状态</option>
              <option value="succeeded">成功</option>
              <option value="failed">失败</option>
              <option value="canceled">取消</option>
            </select>
            <select value={filter.kind ?? ''} onChange={(e) => apply('kind', (e.target.value || undefined) as TaskKind | undefined)}>
              <option value="">全部类型</option>
              <option value="image">图片</option>
              <option value="video">视频</option>
              <option value="text">文本</option>
            </select>
            <select
              value={filter.egress === undefined ? '' : filter.egress ? 'egress' : 'internal'}
              onChange={(e) => apply('egress', e.target.value === '' ? undefined : e.target.value === 'egress')}
            >
              <option value="">全部归属</option>
              <option value="egress">仅出境</option>
              <option value="internal">仅内部</option>
            </select>
            <button className="btn ghost small" onClick={exportCsv}>
              导出 CSV
            </button>
            <button className="btn ghost small" onClick={importRepro} disabled={busy !== null}>
              导入复现包
            </button>
          </div>

          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>厂商</th>
                  <th>模型</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>出境</th>
                  <th>产物</th>
                  <th>成本</th>
                  <th>提示词</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e: AuditEntry) => (
                  <tr key={e.taskId}>
                    <td className="mono">{new Date(e.createdAt).toLocaleString()}</td>
                    <td>
                      {e.providerName}
                      <small className={`scope ${e.providerScope}`}>{e.providerScope === 'external' ? '外部' : '内部'}</small>
                    </td>
                    <td className="mono">{e.model}</td>
                    <td>{e.kind}</td>
                    <td>
                      <span className={`status ${e.status}`}>{e.status}</span>
                    </td>
                    <td>{e.dataEgress ? '是' : '否'}</td>
                    <td>{e.resultCount}</td>
                    <td className="mono">{e.cost ? `${e.cost.amount} ${e.cost.currency}` : '—'}</td>
                    <td className="prompt" title={e.promptPreview}>
                      {e.promptPreview}
                    </td>
                    <td>
                      <button
                        className="btn ghost small"
                        disabled={busy !== null || e.status !== 'succeeded' || e.resultCount === 0}
                        onClick={() => void exportRepro(e.taskId)}
                        title={e.status === 'succeeded' ? '导出可复现包' : '仅成功任务可导出复现包'}
                      >
                        {busy === e.taskId ? '导出中…' : '复现包'}
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="muted">
                      还没有符合条件的生成记录。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            出境 = 提示词/图片发到了外部厂商（scope 为 external）。审计数据取自任务日志，跨会话保留。
          </p>
        </div>
      </div>
    </div>
  );
}
