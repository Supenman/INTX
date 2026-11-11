import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isLongPrompt, promptEditorState, promptLength } from '@/domain';

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

  // 打开就聚焦并光标置尾，用户可以直接接着写。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

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
            placeholder="描述你想要的画面：主体、光线、材质、镜头、氛围…"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onClose();
                onGenerate();
              }
            }}
          />
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
