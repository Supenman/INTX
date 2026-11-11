import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { assetQueryAt, assetRefLabel, insertAssetRef, isLongPrompt, promptEditorState, promptLength } from '@/domain';
import { useAssetStore, type AssetEntry } from '@/app/stores/assetStore';
import { BlobImage } from '@/ui/common/BlobImage';

/**
 * 提示词放大编辑器。
 *
 * 为什么单独做一个浮层：节点卡片是固定尺寸容器（见 §6.9 的教训——节点
 * 绝不能按内容长高，否则会盖住下方节点），卡片里只放得下三行。但真实的
 * 提示词往往是一两百字，在 3 行里改字等于用放大镜拼图。
 *
 * 三条约束写死在这里，不靠使用方自觉：
 * 1. **上游连线优先且只读**。上游接了文字节点时，`resolvePrompt` 会忽略
 *    节点自己的 prompt，如果这里还允许编辑，用户改完会发现「没生效」。
 *    所以显示上游内容、禁用输入框、并说明本地的草稿还在。
 * 2. **Esc 只关不丢**。编辑是即时的（每次输入直接写回节点），所以关掉
 *    不需要「保存」按钮，但也不能有「取消」把用户写的东西回滚掉。
 * 3. **Ctrl/Cmd+Enter 直接生成**，省一次点击。
 */

export interface PromptEditorProps {
  /** 节点标题，用于浮层抬头 */
  nodeTitle: string;
  upstreamText: string | null;
  ownPrompt: string;
  onChange: (next: string) => void;
  onClose: () => void;
  onGenerate: () => void;
}

export function PromptEditor({
  nodeTitle,
  upstreamText,
  ownPrompt,
  onChange,
  onClose,
  onGenerate,
}: PromptEditorProps) {
  const state = promptEditorState({ upstreamText, ownPrompt });
  const ref = useRef<HTMLTextAreaElement>(null);
  const maskDown = useRef(false);
  const [justCopied, setJustCopied] = useState(false);
  /** 非 null 表示 `@` 面板开着，值是 `@` 后面已经敲的查询词 */
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  /**
   * 用户按 Esc 放弃的那段 `@` 查询在文本里的位置。
   *
   * 没有它就会出现这种烦人情况：按 Esc 关掉面板、接着敲「街头」两个字，
   * 第一个字符就让面板重新弹出来——用户会以为 Esc 根本不管用。
   * 记录位置后，同一个 `@` 段内不再弹；敲了空格或换个地方写 `@` 才重新触发。
   */
  const dismissedAt = useRef(-1);
  const assets = useAssetStore((s) => s.assets);

  /**
   * 面板候选：图片/视频/文本，排除已删除与音频。
   *
   * 音频不列进来不是"还没做完"，是它真的带不进生成——列出来再报错，
   * 等于让用户白点一次。
   */
  const candidates = useMemo(() => {
    const q = (query ?? '').toLowerCase();
    const all = Object.values(assets)
      .filter((e) => e.asset.deletedAt === undefined && e.asset.kind !== 'audio')
      .sort((a, b) => b.asset.createdAt - a.asset.createdAt)
      .map((entry) => ({ entry, label: assetRefLabel(entry.asset.kind, entry.asset.hash) }));
    const hit = q === '' ? all : all.filter((x) => x.label.toLowerCase().includes(q));
    return hit.slice(0, 12);
  }, [assets, query]);

  const insert = (pick: { entry: AssetEntry; label: string }) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? state.text.length;
    const next = insertAssetRef(state.text, caret, pick.entry.asset.id, pick.label);
    onChange(next.text);
    setQuery(null);
    // 受控 textarea 重新渲染后光标会跳到末尾，必须显式放回插入点之后，
    // 否则用户写完一句再插引用，整段光标就飞了。
    requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(next.caret, next.caret);
    });
  };

  // 打开就聚焦并光标置尾，用户可以直接接着写。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      // 面板开着时 Esc 只收面板：用户按 Esc 是想"取消这次引用"，
      // 不是想把整个编辑器关掉、把刚才写的东西赶到卡片上去找。
      if (query !== null) {
        const el = ref.current;
        if (el) {
          const caret = el.selectionStart ?? 0;
          dismissedAt.current = caret - query.length - 1;
        }
        setQuery(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, query]);

  const length = promptLength(state.text);

  const copyUpstreamToOwn = () => {
    // 把上游文字「抄一份」到本地。用途：先断开上游再改，不必重新手打。
    onChange(state.text);
    setJustCopied(true);
    window.setTimeout(() => setJustCopied(false), 2000);
  };

  // 关闭条件必须同时满足「按下在遮罩上」和「抬起也在遮罩上」。
  // 只判 mousedown 的话，从面板内部按下、拖到遮罩上松手会被误关；
  // 更常见的是面板内容重排后，原本的点击落在了遮罩上——
  // 用户会以为「点了个按钮结果整个浮层消失了」。
  return createPortal(
    <div
      className="panel-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) maskDown.current = true;
      }}
      onMouseUp={(e) => {
        const wasMask = maskDown.current && e.target === e.currentTarget;
        maskDown.current = false;
        if (wasMask) onClose();
      }}
    >
      <div className="panel prompt-editor" role="dialog" aria-label="提示词放大编辑">
        <div className="panel-head">
          <h2>
            提示词 · {nodeTitle}
            <span className="prompt-editor-count" data-empty={length === 0 ? 'true' : 'false'}>
              {length} 字
              {isLongPrompt(state.text) ? ' · 较长' : ''}
            </span>
          </h2>
          <button className="icon-btn" title="关闭 (Esc)" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="prompt-editor-body">
          {state.fromUpstream ? (
            <div className="prompt-editor-note" data-testid="upstream-note">
              这段文字来自上游文字节点，是<b>真正会发出去</b>的内容，在这里改不会生效。
              {state.ownText.trim() !== '' && (
                <>
                  {' '}
                  你在这个节点上写的草稿仍然保留，断开上游后会自动回到那段。
                  <button
                    className="link-btn"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyUpstreamToOwn();
                    }}
                  >
                    {justCopied ? '已抄到本地草稿 ✓' : '抄到本地草稿'}
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="prompt-editor-note weak">
              直接编辑，改动立刻生效；Ctrl/⌘ + Enter 可以保存并生成。
            </div>
          )}

          <textarea
            ref={ref}
            className="prompt-editor-textarea"
            data-testid="prompt-editor-textarea"
            value={state.text}
            readOnly={state.fromUpstream}
            placeholder="描述你想要的画面：主体、光线、材质、镜头、氛围…  输入 @ 可以引用资产"
            onChange={(e) => {
              const next = e.target.value;
              onChange(next);
              const caret = e.target.selectionStart ?? next.length;
              const q = assetQueryAt(next, caret);
              if (q === null) {
                dismissedAt.current = -1;
                setQuery(null);
              } else {
                const at = caret - q.length - 1;
                setQuery(at === dismissedAt.current ? null : q);
              }
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (query !== null && candidates.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((i) => (i + 1) % candidates.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((i) => (i - 1 + candidates.length) % candidates.length);
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  const pick = candidates[Math.min(active, candidates.length - 1)];
                  if (pick) insert(pick);
                  return;
                }
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onClose();
                onGenerate();
              }
            }}
          />

          {query !== null && (
            <div className="asset-pick" data-testid="asset-pick">
              <div className="asset-pick-head">
                引用资产 · ↑↓ 选择 · Enter 插入 · Esc 取消
                {query !== '' && <span className="asset-pick-query">筛选：{query}</span>}
              </div>
              {candidates.length === 0 ? (
                <div className="asset-pick-empty">
                  {Object.keys(assets).length === 0
                    ? '资产库还是空的：先导入一张图，或先生成一张'
                    : '没有匹配的资产'}
                </div>
              ) : (
                <div className="asset-pick-list">
                  {candidates.map((c, i) => (
                    <button
                      key={c.entry.asset.id}
                      type="button"
                      className={`asset-pick-item${i === active ? ' active' : ''}`}
                      // 用 mousedown 阻止默认聚焦转移，textarea 才不会在点击前失焦，
                      // 光标位置也就还在，插入点才对。
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => insert(c)}
                    >
                      <span className="asset-pick-thumb">
                        {c.entry.asset.kind === 'image' ? (
                          <BlobImage entry={c.entry} />
                        ) : (
                          <span className="asset-pick-icon">{c.entry.asset.kind === 'video' ? '▶' : 'T'}</span>
                        )}
                      </span>
                      <span className="asset-pick-label">{c.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="prompt-editor-foot">
          <span className="prompt-editor-hint">
            {state.fromUpstream ? '只读 · 由上游节点提供' : 'Esc 关闭'}
          </span>
          <div className="prompt-editor-actions">
            <button className="btn" onClick={onClose}>
              完成
            </button>
            <button
              className="btn primary"
              disabled={state.fromUpstream === false && state.text.trim() === ''}
              title={state.fromUpstream ? '用上游这段提示词生成' : '用当前内容生成'}
              onClick={() => {
                onClose();
                onGenerate();
              }}
            >
              保存并生成
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
