import type { AssetSnapshot, ProjectSnapshot } from '../../application/ports/snapshotRepositories';
import type { StorageError, Stored } from '../../application/ports/taskRepository';
import { err, ok, type Result } from '../../domain/shared/result';

type Validator = (value: unknown) => boolean;
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const string: Validator = (v) => typeof v === 'string';
const id: Validator = (v) => string(v) && (v as string).length > 0;
const number: Validator = (v) => typeof v === 'number' && Number.isFinite(v);
const tick: Validator = (v) => number(v) && (v as number) >= 0;
const boolean: Validator = (v) => typeof v === 'boolean';
const oneOf = (...values: unknown[]): Validator => (v) => values.includes(v);
const array = (valid: Validator): Validator => (v) => Array.isArray(v) && Array.from(v).every(valid);
const strings = array(string);
const shape = (required: Record<string, Validator>, optional: Record<string, Validator> = {}, open = false): Validator => (v) =>
  record(v) && Object.entries(required).every(([k, valid]) => Object.hasOwn(v, k) && valid(v[k]))
  && Object.entries(optional).every(([k, valid]) => v[k] === undefined || valid(v[k]))
  && (open || Object.keys(v).every((k) => Object.hasOwn(required, k) || Object.hasOwn(optional, k)));
const status = oneOf('idle', 'success', 'loading', 'error');
const nodeText = shape({ id, status, content: string }, { errorDetails: string });
const nodeImage = shape({ id, status, content: string, naturalWidth: number, naturalHeight: number, bytes: number, mimeType: string }, { errorDetails: string, storageKey: string, outputNodeId: string });
const metadata = shape({}, {
  ...Object.fromEntries(['content', 'composerContent', 'prompt', 'inputPrompt', 'retrySourceId', 'errorDetails', 'model', 'size', 'quality', 'background', 'primaryTextId', 'seconds', 'vquality', 'generateAudio', 'watermark', 'videoMode', 'audioVoice', 'audioFormat', 'audioSpeed', 'audioInstructions', 'primaryImageId', 'storageKey', 'mimeType', 'imageTaskId', 'videoTaskId', 'groupId'].map((k) => [k, string])),
  ...Object.fromEntries(['fontSize', 'count', 'textCount', 'naturalWidth', 'naturalHeight', 'bytes', 'durationMs', 'timelineOrder', 'timelineStartSeconds', 'timelineTrimStartSeconds', 'timelineTrimEndSeconds'].map((k) => [k, number])),
  status, generationMode: oneOf('text', 'image', 'video', 'audio'), generationType: oneOf('generation', 'edit'),
  colorGrade: oneOf('original', 'warm', 'cool', 'monochrome', 'vivid', 'faded'),
  reasoningEffort: oneOf('auto', 'low', 'medium', 'high', 'xhigh'), videoTaskProvider: oneOf('openai', 'gemini', 'runninghub'),
  references: strings, freeResize: boolean, interactive: boolean, texts: array(nodeText), images: array(nodeImage),
}, true); // Plugin metadata remains an open JSON dictionary; known fields still have their real types.
const node = shape({ id, type: id, title: string, position: shape({ x: number, y: number }), width: number, height: number }, { metadata });
const connection = shape({ id, fromNodeId: id, toNodeId: id });
const reference = shape({ id, type: id, title: string }, { dataUrl: string, storageKey: string, text: string });
const message = shape({ id, role: oneOf('user', 'assistant', 'system', 'tool', 'error'), text: string }, {
  title: string, meta: string, detail: () => true, references: array(reference),
});
const session = shape({ id, title: string, messages: array(message), createdAt: string, updatedAt: string });
const timelineClip = shape({ id, nodeId: id, startTick: tick, durationTick: tick, sourceStartTick: tick }, { volume: number });
const timelineTrack = shape({ id, kind: oneOf('video', 'audio', 'text'), clips: array(timelineClip) });
const timeline = shape({ fps: number, tracks: array(timelineTrack) });
const project = shape({
  id, title: string, createdAt: string, updatedAt: string, nodes: array(node), connections: array(connection),
  chatSessions: array(session), activeChatId: (v) => v === null || string(v),
  backgroundMode: oneOf('dots', 'lines', 'blank'), showImageInfo: boolean, viewport: shape({ x: number, y: number, k: number }),
}, { folder: string, timeline });
const tombstone = shape({ id, deletedAt: string }, { project, purged: boolean });
const mediaData = (url: string) => shape({ [url]: string, width: number, height: number, bytes: number, mimeType: string }, { storageKey: string });
const asset: Validator = (v) => record(v) && shape({
  id, kind: oneOf('text', 'image', 'video'), title: string, coverUrl: string, tags: strings, createdAt: string, updatedAt: string,
  data: v.kind === 'text' ? shape({ content: string }) : mediaData(v.kind === 'image' ? 'dataUrl' : 'url'),
}, { source: string, note: string, metadata: record })(v);
const unique = (values: { id: string }[]) => new Set(values.map((v) => v.id)).size === values.length;
const validProjects: Validator = (v) => shape({ projects: array(project), deletedProjects: array(tombstone) })(v)
  && unique((v as ProjectSnapshot).projects) && unique((v as ProjectSnapshot).deletedProjects);
const validAssets: Validator = (v) => shape({ assets: array(asset) })(v) && unique((v as AssetSnapshot).assets);

export const snapshotCorruptData = (): StorageError => ({ code: 'corrupt_data', message: '快照存储数据损坏或字段非法，已拒绝覆盖' });

/**
 * 待写入的草稿不合 schema，与「库里已有的数据坏了」是两回事。
 *
 * 错误码沿用 `corrupt_data`：它是写队列和契约测试的稳定契约，拆码要动一批消费者。
 * 但文案必须把责任说清楚——被拒绝的是这一次写入，已保存的数据没有任何改动。
 * 共用一个「数据损坏」文案会把用户吓到以为画布已经丢了（实际上只是草稿里某个
 * 字段非法，改回去就能继续保存）。
 */
export const snapshotInvalidData = (): StorageError => ({ code: 'corrupt_data', message: '本次要保存的快照数据字段非法，已拒绝写入；已保存的数据未受影响' });
export const validRevision = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** Reject JSON's silent conversions before stringify. Optional object undefined means absent,
 * as in current errorDetails/groupId/prompt edits; arbitrary nested detail/plugin undefined rejects.
 * Required fields and all array items must exist.
 * No class instances, accessors, symbols, non-enumerable data, cycles, functions or non-finite numbers.
 */
function jsonCopy(v: unknown, ancestors = new Set<object>(), path: string[] = []): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean' || number(v)) return v;
  if (typeof v !== 'object' || v === null || ancestors.has(v)) throw new Error('non-json');
  const isArray = Array.isArray(v);
  if (!isArray && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error('non-json');
  ancestors.add(v);
  const descriptors = Object.getOwnPropertyDescriptors(v);
  if (Reflect.ownKeys(v).some((key) => typeof key !== 'string' || (!isArray || key !== 'length')
    && (!descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value')))) throw new Error('non-json');
  let copy: unknown;
  if (isArray) {
    if (Object.keys(v).length !== v.length || Object.keys(v).some((k, i) => k !== String(i))) throw new Error('non-json');
    copy = Array.from(v, (item, i) => jsonCopy(item, ancestors, [...path, String(i)]));
  } else {
    // Only dictionary roots declared open by the current model allow undefined-as-absent.
    // Unknown nested detail/plugin payloads have no optional-field contract to justify loss.
    const assetMetadata = path.length === 3 && path[0] === 'assets' && path[2] === 'metadata';
    const nodeMetadata = path.length === 5 && path[0] === 'projects' && path[2] === 'nodes' && path[4] === 'metadata';
    const unknownPayload = path.includes('metadata') || path.includes('detail');
    const typedResult = path.length === 7 && path[0] === 'projects' && path[2] === 'nodes' && path[4] === 'metadata' && ['texts', 'images'].includes(path[5]);
    if (unknownPayload && !assetMetadata && !nodeMetadata && !typedResult && Object.values(descriptors).some((d) => d.value === undefined)) throw new Error('non-json');
    copy = Object.fromEntries(Object.entries(descriptors).filter(([, d]) => d.value !== undefined)
      .map(([k, d]) => [k, jsonCopy(d.value, ancestors, [...path, k])]));
  }
  ancestors.delete(v);
  return copy;
}

export interface SnapshotCodec<T> {
  empty(): T;
  copy(value: T): Result<T, StorageError>;
  decode(raw: unknown): Result<Stored<T>, StorageError>;
}
function codec<T>(empty: () => T, valid: Validator): SnapshotCodec<T> {
  const copy = (value: T): Result<T, StorageError> => {
    try {
      // Copy first so accessors are rejected without invoking them; schema rejects missing essentials.
      const copied = jsonCopy(value);
      return valid(value) && valid(copied) ? ok(copied as T) : err(snapshotInvalidData());
    } catch { return err(snapshotInvalidData()); }
  };
  return {
    empty, copy,
    decode(raw) {
      if (raw === undefined) return ok({ value: empty(), revision: 0 });
      try {
        if (typeof raw !== 'string') return err(snapshotCorruptData());
        const v: unknown = JSON.parse(raw);
        if (!record(v)) return err(snapshotCorruptData());
        if (v.version !== 0 || record(v.metadata) && v.metadata.formatVersion !== 1) return err({ code: 'unsupported_format', message: '不支持此快照存储格式，已拒绝覆盖' });
        if (!shape({ state: () => true, version: oneOf(0) }, { metadata: shape({ formatVersion: oneOf(1), revision: validRevision }) })(v)) return err(snapshotCorruptData());
        // Present undefined/null metadata is never a legacy envelope.
        if (Object.hasOwn(v, 'metadata') && !record(v.metadata)) return err(snapshotCorruptData());
        const copied = copy(v.state as T);
        return copied.ok ? ok({ value: copied.value, revision: record(v.metadata) ? v.metadata.revision as number : 0 }) : copied;
      } catch { return err(snapshotCorruptData()); }
    },
  };
}
export const projectSnapshotCodec = codec<ProjectSnapshot>(() => ({ projects: [], deletedProjects: [] }), validProjects);
export const assetSnapshotCodec = codec<AssetSnapshot>(() => ({ assets: [] }), validAssets);
export function encodeSnapshot<T>(stored: Stored<T>): string {
  return JSON.stringify({ state: stored.value, version: 0, metadata: { formatVersion: 1, revision: stored.revision } });
}
export function nextSnapshot<T>(value: T, expectedRevision: number, actualRevision: number): Result<Stored<T>, StorageError> {
  if (!validRevision(expectedRevision) || !validRevision(actualRevision + 1)) return err(snapshotCorruptData());
  return expectedRevision === actualRevision ? ok({ value, revision: actualRevision + 1 }) : err({
    code: 'conflict', message: '集合已被其他写入更新，请明确处理冲突后保存', expectedRevision, actualRevision,
  });
}
