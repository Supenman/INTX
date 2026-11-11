import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { expandBatchTitle, sortForExport } from '@/domain';
import { renameNodesByPattern, useGraphStore } from '@/app/stores/graphStore';

/**
 * 批量改名。
 *
 * 为什么不是「一个个改名」：十个图片节点手工点十次，每次都要重新想名字，
 * 而且中途一定会出现两个重名。给一个模板统一编号，一次就完。
 *
 * 为什么独立成 hook 而不是写在 Canvas 里：Canvas.tsx 已经贴着 800 行的
 * 结构预算上限，这个功能连状态带浮层要几十行，塞进去必然破线。
 */

export interface BatchRenameApi {
  /** 打开面板 */
  open: () => void;
  /** 面板本身，没打开时是 null */
  node: React.ReactNode;
}

export function useBatchRename(selectedIds: string[], onDone: (message: string) => void): BatchRenameApi {
  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState('图 #');
  const nodes = useGraphStore((s) => s.nodes);

  /**
   * 预览用的顺序必须和真正执行时一致——都走 `sortForExport`。
   * 如果预览按选中顺序、执行按坐标顺序，用户看到的编号和落下去的对不上，
   * 而这种错位在十来张图里很难一眼发现。
   */
  const ordered = useMemo(() => {
    const picked = selectedIds.map((id) => nodes[id]).filter((n): n is NonNullable<typeof n> => Boolean(n));
    return sortForExport(picked, (n) => n.position);
  }, [selectedIds, nodes]);

  const preview = ordered.slice(0, 3).map((_, i) => expandBatchTitle(pattern, i + 1, ordered.length));

  function close(): void {
    setOpen(false);
  }

  function apply(): void {
    const count = renameNodesByPattern(selectedIds, pattern);
    setOpen(false);
    onDone(count > 0 ? `已重命名 ${count} 个节点` : '没有可重命名的节点');
  }

  const node = open
    ? createPortal(
        <div
          className="panel-mask"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="panel batch-rename" role="dialog" aria-label="批量重命名">
            <div className="panel-head">
              <h2>批量重命名</h2>
              <span className="muted small">已选 {ordered.length} 个</span>
            </div>
            <div className="batch-rename-body">
              <label className="batch-rename-label" htmlFor="batch-rename-pattern">
                名称模板
              </label>
              <input
                id="batch-rename-pattern"
                className="batch-rename-input"
                value={pattern}
                autoFocus
                placeholder="图 #"
                onChange={(e) => setPattern(e.target.value)}
                onKeyDown={(e) => {
                  // 画布快捷键不能穿透：这里按 Delete 是删字，不是删节点
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    apply();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    close();
                  }
                }}
              />
              <p className="muted small batch-rename-hint">
                <code>#</code> 会换成按画布顺序补零的序号；不写 <code>#</code> 就自动加在末尾。
              </p>
              <div className="batch-rename-preview">
                {preview.map((name, i) => (
                  <span key={i} className="batch-rename-chip">
                    {name}
                  </span>
                ))}
                {ordered.length > preview.length && (
                  <span className="muted small">…共 {ordered.length} 个</span>
                )}
              </div>
              {ordered.length === 0 && <p className="muted small">先在画布上选中节点。</p>}
            </div>
            <div className="batch-rename-foot">
              <button className="btn" onClick={close}>
                取消
              </button>
              <button className="btn primary" onClick={apply} disabled={ordered.length === 0}>
                重命名
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return { open: () => setOpen(true), node };
}
