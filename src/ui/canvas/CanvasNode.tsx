import { memo, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  MAX_NODE_TITLE,
  extFromMime,
  getNodeDefinition,
  isLongPrompt,
  nodeTitle,
  parseGrid,
  readTaskOutcome,
  resolvePrompt,
  splitPromptSegments,
  textInputPortId,
  type ProjectNode,
} from '@/domain';
import { latestTaskForNode, useTaskStore } from '@/app/stores/taskStore';
import type { RunGenerationOptions } from '@/app/useCases/runGeneration';
import { useAssetStore } from '@/app/stores/assetStore';
import { removeNodes, setNodeParam, setNodeTitle, useGraphStore } from '@/app/stores/graphStore';
import { useProviderStore } from '@/app/stores/providerStore';
import { buildStoryboardPng, readAssetBytes } from '@/app/useCases/storyboardExport';
import { BlobImage } from '@/ui/common/BlobImage';
import { downloadBlob, downloadBytes } from '@/ui/common/download';
import { NodeHoverToolbar } from './NodeHoverToolbar';
import { PromptEditor } from './PromptEditor';
import { outcomeCopy } from './outcomeCopy';

/**
 * 通用节点渲染。
 *
 * 只订阅自己的数据：`useTaskStore` 里用 selector 精确取本节点的最近任务，
 * 别的节点跑任务不会让这个组件重渲染。
 */

export interface CanvasNodeData extends Record<string, unknown> {
  node: ProjectNode;
  onGenerate: (nodeId: string, options?: RunGenerationOptions) => void;
  onCancel: (nodeId: string) => void;
}

export const CanvasNode = memo(function CanvasNode({ id, data, selected }: NodeProps) {
  const { node, onGenerate, onCancel } = data as CanvasNodeData;
  const def = getNodeDefinition(node.defKind);

  const task = useTaskStore((s) => latestTaskForNode(s.tasks, id));

  /**
   * 标题编辑态。放在最前面，和产物订阅一样必须在提前返回之前调用。
   *
   * 用 `useRef` 记「正在提交」，因为 Enter 和失焦会连着触发两次（Enter 提交后
   * 输入框卸载、浏览器补一个 blur）。没有这道锁会写两次同名，虽然结果一样，
   * 但会多记一条撤销历史——用户按一次 Ctrl+Z 发现没变化，就会以为撤销坏了。
   */
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleCommitting = useRef(false);

  function beginTitleEdit(): void {
    setTitleDraft(nodeTitle(node, def?.title ?? ''));
    setEditingTitle(true);
  }

  function commitTitle(): void {
    if (titleCommitting.current) return;
    titleCommitting.current = true;
    setEditingTitle(false);
    setNodeTitle(id, titleDraft);
    // 下一个事件循环再解锁，保证同一轮里的 blur 被吃掉
    queueMicrotask(() => {
      titleCommitting.current = false;
    });
  }

  /**
   * 产物订阅。注意这两个 hook 必须在提前返回之前调用，
   * 否则「未知节点」那条分支会改变 hooks 顺序，React 会直接抛错。
   */
  const primary = useAssetStore((s) => (node.assetId ? s.assets[node.assetId] : undefined));
  const hasPrimary = primary !== undefined;
  // 只有演示厂商时明确告诉用户这不是真图；接了真厂商后标注自动消失。
  // 必须放在下面 `if (!def) return` 之前，否则 hooks 顺序会变。
  const demoMode = useProviderStore(
    (s) => s.configs.length === 0 || s.configs.every((c) => c.adapter === 'mock'),
  );
  const derivedIds = node.derivedAssetIds;
  const allAssets = useAssetStore((s) => s.assets);
  /**
   * 上游文本连进来时，卡片上显示的就是真正会被送去生成的那段文字。
   * 端口名必须走 textInputPortId()：这里曾写死 'text'（文字节点的输出口），
   * 于是生成节点的 'prompt' 口永远查不到东西，卡片一直说「还没有提示词」。
   */
  const upstreamText = useGraphStore((s) =>
    incomingText(s.edges, s.nodes, node.id, textInputPortId(node.defKind)),
  );
  /**
   * 注意不要就地 .map().filter() 生成新数组：
   * 每渲染一次一个新引用，尽管不影响正确性，但会让下游比较全部失效。
   * useMemo 依赖 derivedIds 与资产表本身（immer 保证未变时引用不变）。
   */
  const derived = useMemo(() => {
    if (!derivedIds) return [];
    const out = [];
    for (const aid of derivedIds) {
      const found = allAssets[aid];
      if (found) out.push(found);
    }
    return out;
  }, [allAssets, derivedIds]);

  // 导出动作的局部反馈。不塞进 taskStore：下载不是生成任务，
  // 塞进去会污染任务日志和崩溃恢复的语义。
  const [exportError, setExportError] = useState<string | null>(null);
  // 提示词放大编辑器是否打开。必须放在 `if (!def)` 之前，保持 hooks 顺序稳定。
  const [promptOpen, setPromptOpen] = useState(false);
  const reportExportError = (message: string) => {
    setExportError(message);
    window.setTimeout(() => setExportError(null), 4000);
  };
  const exportGrid = async () => {
    const r = await buildStoryboardPng(id);
    if (!r.ok) {
      reportExportError(r.message);
      return;
    }
    downloadBlob(r.blob, r.filename);
  };
  const saveCell = async (assetId: string, index: number) => {
    const r = await readAssetBytes(assetId);
    if (!r.ok) {
      reportExportError(r.message);
      return;
    }
    downloadBytes(r.bytes, r.mime, `分镜-第${index + 1}格.${extFromMime(r.mime)}`);
  };

  if (!def) {
    return (
      <div className="node selected">
        <div className="node-head">未知节点</div>
        <div className="node-body">类型「{node.defKind}」未注册</div>
      </div>
    );
  }

  /**
   * 卡片上必须显示**真正会发给上游的那段文字**。
   *
   * 真机第一次跑就撞上这个坑：提示词是从上游文字节点连进来的，执行层用
   * resolvePrompt(node, upstreamText) 拼出了请求、上游也确实收到了（回了
   * HTTP 451），但卡片只读节点自己的 params.prompt，于是显示「还没有提示词」
   * ——用户看到的是「明明没提示词却报错」，无从判断到底哪里出了问题。
   * 显示层和执行层共用一个解析函数，才不会各说各话。
   */
  const effectivePrompt = resolvePrompt(node, upstreamText);
  const promptFromUpstream = upstreamText.trim() !== '' && effectivePrompt === upstreamText.trim();
  const content = typeof node.params.content === 'string' ? node.params.content : '';

  const outputKind = typeof node.params.outputKind === 'string' ? node.params.outputKind : 'image';
  const busy = task?.status === 'running' || task?.status === 'queued';

  // 节点是固定尺寸容器：不用 min-height，否则出图后长高会盖住下方节点，
  // 用户点自己的按钮实际点到别人的卡片上（表现为「点了没反应」）。
  return (
    <div
      className={`node${selected ? ' selected' : ''}`}
      style={{ width: node.size.width, height: node.size.height }}
    >
      <button
        className="node-delete-btn nodrag"
        title="删除节点 (Delete)"
        aria-label="删除节点"
        onClick={(e) => {
          e.stopPropagation();
          removeNodes([id]);
        }}
      >
        ×
      </button>
      <NodeHoverToolbar
        nodeId={id}
        defKind={node.defKind}
        hasAsset={hasPrimary}
        busy={busy}
        onGenerate={onGenerate}
        onCancel={onCancel}
      />
      {def.inputPorts.map((port, i) => (
        <Handle
          key={port.id}
          id={port.id}
          type="target"
          position={Position.Left}
          style={{ top: `${((i + 1) / (def.inputPorts.length + 1)) * 100}%` }}
          title={`${port.label}（${port.accepts.join(' / ')}）`}
        />
      ))}

      <div className="node-head">
        <span className={`node-dot${def.category === 'generate' ? ' generate' : ''}`} />
        {editingTitle ? (
          <input
            className="node-title-input nodrag nowheel"
            value={titleDraft}
            autoFocus
            maxLength={MAX_NODE_TITLE}
            aria-label="节点名称"
            // 聚焦即全选：改名时多数是整句重写，不用先手动删干净
            onFocus={(e) => e.target.select()}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              // 画布快捷键（Delete / 方向键）不能穿透到输入框外面
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                commitTitle();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setEditingTitle(false);
              }
            }}
          />
        ) : (
          <>
            <span
              className={`node-title${node.title ? '' : ' default'}`}
              title={node.title ? '点击改名' : '点击给这个节点起个名字'}
              onClick={(e) => {
                e.stopPropagation();
                beginTitleEdit();
              }}
            >
              {nodeTitle(node, def.title)}
            </span>
            {/*
              铅笔入口。单击标题也能改，但「能点」是我知道的，用户不知道——
              没有可见入口，改名功能等于不存在。只在悬停时出现，不占常态空间。
            */}
            <button
              className="node-title-edit nodrag"
              title="重命名"
              aria-label="重命名节点"
              onClick={(e) => {
                e.stopPropagation();
                beginTitleEdit();
              }}
            >
              ✎
            </button>
          </>
        )}
        {demoMode && hasPrimary && (
          <span className="node-demo-badge" title="本地演示厂商生成的是占位图，不是真实作品">
            演示产物
          </span>
        )}
      </div>

      <div className="node-body">
        {node.defKind === 'text-input' && (
          <div className="node-text">
            {upstreamText && (
              <>
                <div className="node-prompt-src" title="上游接进来的文字会优先于你在下面写的内容">
                  ↑ 来自上游文字节点
                </div>
                <div className="node-upstream">{upstreamText}</div>
              </>
            )}
            <textarea
              className="node-textarea nodrag"
              value={content}
              placeholder="写点什么…"
              onChange={(e) => setNodeParam(id, 'content', e.target.value)}
            />
          </div>
        )}

        {node.defKind === 'generate' && (
          <>
            {promptFromUpstream && (
              <div className="node-prompt-src" title="卡片显示的就是会发给上游的那段文字">
                ↑ 提示词来自上游文字节点
              </div>
            )}
            <div className="node-prompt" data-testid="node-prompt">
              {effectivePrompt ? (
                /*
                 * `@资产` 引用在卡片上渲染成 chip，而不是把
                 * `@[图片 d1ddc1](asset:as_xxx)` 原样摊给用户看。
                 * chip 带 title 说明它怎么参与生成——不然用户只看到
                 * 一个陌生的小标签，不知道图到底有没有被带进去。
                 */
                splitPromptSegments(effectivePrompt).map((seg, i) =>
                  seg.type === 'text' ? (
                    <span key={i}>{seg.text}</span>
                  ) : (
                    <span key={i} className="prompt-ref" title="作为参考素材发送">
                      {seg.ref.label}
                    </span>
                  ),
                )
              ) : (
                <span className="node-empty">还没有提示词</span>
              )}
            </div>
            {/*
              长提示词在卡片里只能看见三行。给一个显式入口，而不是让用户
              去猜「这个框能不能滚」。短提示词也保留入口，只是不强调。
            */}
            <button
              className={`node-prompt-expand nodrag${isLongPrompt(effectivePrompt) ? ' attention' : ''}`}
              data-testid="prompt-expand"
              title="放大编辑提示词"
              onClick={(e) => {
                e.stopPropagation();
                setPromptOpen(true);
              }}
            >
              {isLongPrompt(effectivePrompt) ? '放大编辑 · 内容较长' : '放大编辑'}
            </button>
            {primary ? (
              <div className="node-result">
                <BlobImage entry={primary} />
              </div>
            ) : (
              // 节点高度是固定的（出图前后不能变），没产物时给一个占位框，
              // 否则卡片下半截是一大片说不出所以然的空白。
              <div className="node-result empty">
                <span className="node-empty">还没有产物</span>
              </div>
            )}
            <div className="node-field">
              <span>产出</span>
              <b>{outputKind}</b>
            </div>
            {outputKind !== 'image' && (
              <div className="node-empty" title="当前只实现了图片生成适配器">
                演示厂商只出图片，选「{outputKind}」不会产出对应媒体
              </div>
            )}
            <div className="node-field">
              <span>宽高比</span>
              <b>{String(node.params.aspectRatio ?? '1:1')}</b>
            </div>
            {busy ? (
              <button className="node-generate-btn nodrag danger-btn" onClick={() => onCancel(id)}>
                取消
              </button>
            ) : (
              <button className="node-generate-btn nodrag" onClick={() => onGenerate(id)}>
                {hasPrimary ? '重新生成' : '生成'}
              </button>
            )}
          </>
        )}

        {node.defKind === 'asset' && (
          <div className="node-preview">
            {primary ? <BlobImage entry={primary} /> : <span className="node-empty">接入素材后这里显示预览</span>}
          </div>
        )}

        {node.defKind === 'storyboard' && (
          <>
            <div className="node-prompt">
              一段分镜文本，按宫格拆成 N 张图
              <span className="node-field-inline">
                {String(node.params.grid ?? '2x2')} · {String(node.params.aspectRatio ?? '1:1')}
              </span>
            </div>
            {derived.length > 0 && (
              <div
                className="node-grid"
                style={{ gridTemplateColumns: `repeat(${parseGrid(String(node.params.grid ?? '2x2')).cols}, 1fr)` }}
              >
                {derived.map((entry, i) =>
                  entry ? (
                    <div className="grid-cell" key={entry.asset.id}>
                      <BlobImage entry={entry} />
                      <span>{i + 1}</span>
                      <button
                        className="grid-cell-save nodrag"
                        title={`另存第 ${i + 1} 格`}
                        onClick={() => void saveCell(entry.asset.id, i)}
                      >
                        ↓
                      </button>
                    </div>
                  ) : null,
                )}
              </div>
            )}
            <div className="node-actions">
              {busy ? (
                <button className="node-generate-btn nodrag danger-btn" onClick={() => onCancel(id)}>
                  取消
                </button>
              ) : (
                <button className="node-generate-btn nodrag" onClick={() => onGenerate(id)}>
                  拆分
                </button>
              )}
              {derived.length > 0 && (
                <button
                  className="node-secondary-btn nodrag"
                  title="把全部分格拼成一张 PNG 下载"
                  onClick={() => void exportGrid()}
                >
                  导出拼图
                </button>
              )}
            </div>
            {exportError && <div className="node-export-error">{exportError}</div>}
          </>
        )}

        <TaskStatusLine task={task} nodeId={id} onGenerate={onGenerate} />
      </div>

      {/*
        浮层挂在节点内部，用 position:fixed 脱离节点坐标系。
        不挂到 body：那需要 createPortal 并处理 ReactFlow 的缩放上下文，
        对一个纯展示浮层不值得多这一层。
      */}
      {promptOpen && (
        <PromptEditor
          nodeTitle={def.title}
          upstreamText={upstreamText || null}
          ownPrompt={typeof node.params.prompt === 'string' ? node.params.prompt : ''}
          onChange={(next) => setNodeParam(id, 'prompt', next)}
          onClose={() => setPromptOpen(false)}
          onGenerate={() => onGenerate(id)}
        />
      )}

      {def.outputPorts.map((port, i) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={Position.Right}
          style={{ top: `${((i + 1) / (def.outputPorts.length + 1)) * 100}%` }}
          title={`${port.label}（${port.accepts.join(' / ')}）`}
        />
      ))}
    </div>
  );
});

/** 某个节点的某个输入口上接进来的文本，按连线顺序拼起来。 */
function incomingText(
  edges: Record<string, { target: string; targetPort: string; source: string }>,
  nodes: Record<string, ProjectNode>,
  nodeId: string,
  portId: string,
): string {
  const parts: string[] = [];
  for (const e of Object.values(edges)) {
    if (e.target !== nodeId || e.targetPort !== portId) continue;
    const src = nodes[e.source];
    const t = src && typeof src.params.content === 'string' ? src.params.content.trim() : '';
    if (t) parts.push(t);
  }
  return parts.join('\n');
}

function TaskStatusLine({
  task,
  nodeId,
  onGenerate,
}: {
  task: ReturnType<typeof latestTaskForNode>;
  nodeId: string;
  onGenerate: (nodeId: string, options?: RunGenerationOptions) => void;
}) {
  if (!task) return null;

  if (task.status === 'running') {
    const hasProgress = task.upstreamProgress !== null;
    return (
      <div className="node-status">
        <span style={{ color: 'var(--accent)' }}>{phaseLabel(task.phase)}</span>
        <span className={`bar${hasProgress ? '' : ' indeterminate'}`}>
          <i style={hasProgress ? { width: `${Math.round(task.upstreamProgress! * 100)}%` } : undefined} />
        </span>
        {hasProgress && <span style={{ fontFamily: 'var(--mono)' }}>{Math.round(task.upstreamProgress! * 100)}%</span>}
      </div>
    );
  }

  if (task.status === 'failed') {
    /**
     * 失败态只查 domain 算出来的三态，不在渲染里按错误码分支。
     * 之前 submission_uncertain 是这里的一个特判，加一个码就要改一次 UI；
     * 现在新增错误码只改 `domain/task/outcome.ts`，文案只改 outcomeCopy.ts。
     */
    const outcome = readTaskOutcome(task);
    const copy = outcomeCopy(outcome);
    return (
      <div className="node-status failed" title={copy.hint}>
        <span className="err-text">
          {copy.badge} {task.error?.message ?? '失败'}
        </span>
        {copy.action && (
          <button
            className="link-btn nodrag"
            onClick={() => {
              // 点了确认就真的跑一次，而且只补缺失的分镜格。
              // 以前只把状态改回 queued：busy 判定会把按钮变成「取消」，
              // 用户永远点不到执行，任务就那么卡着。
              onGenerate(nodeId, { resume: true });
            }}
          >
            {copy.action}
          </button>
        )}
      </div>
    );
  }

  if (task.status === 'succeeded') {
    return (
      <div className="node-status" style={{ color: 'var(--ok)' }}>
        <span>✓ 完成（第 {task.attempt} 次）</span>
      </div>
    );
  }

  if (task.status === 'queued') {
    return (
      <div className="node-status" style={{ color: 'var(--warn)' }}>
        <span>排队中</span>
      </div>
    );
  }

  if (task.status === 'canceled') {
    return (
      <div className="node-status canceled" title={task.error?.message}>
        <span>已取消{task.error ? ` · ${task.error.message}` : ''}</span>
      </div>
    );
  }

  return null;
}

function phaseLabel(phase: string | null): string {
  switch (phase) {
    case 'submitting':
      return '提交中';
    case 'generating':
      return '生成中';
    case 'downloading':
      return '下载中';
    default:
      return '处理中';
  }
}
