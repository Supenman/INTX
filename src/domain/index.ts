/**
 * 领域层统一出口。
 *
 * 这一层不 import 任何 IO（fetch / fs / localStorage / Tauri invoke），
 * 纯 TypeScript 类型与纯函数，因此可以在 node 环境里直接单测。
 * 应用层与基础设施层都应该从这里取类型，而不是深入子目录。
 */

// 通用
export { createId, __resetIdCounter } from './shared/id';
export { ok, err, isOk, isErr, type Result, type Ok, type Err } from './shared/result';

// 资产
export {
  ASSET_KINDS,
  createAsset,
  findByHash,
  isAlive,
  isSupportedMime,
  kindFromMime,
  restoreAsset,
  softDeleteAsset,
  type Asset,
  type AssetError,
  type AssetErrorCode,
  type AssetKind,
  type AssetOrigin,
  type CreateAssetInput,
} from './asset/model';

// 任务
export {
  TASK_KINDS,
  TASK_PHASES,
  TASK_STATUSES,
  canTransition,
  createTask,
  expectedAssetKind,
  isTerminal,
  normalizeError,
  setProgress,
  transition,
  type CreateTaskInput,
  type ErrorCode,
  type GenerationParams,
  type Task,
  type TaskError,
  type TaskKind,
  type TaskPhase,
  type TaskStatus,
  type TaskTransitionError,
} from './task/model';

// 节点
export { acceptsType, isValidConnection, validateConnection } from './node/port';
export type {
  ConnectionIntent,
  ExistingEdge,
  PortIssue,
  PortIssueCode,
  PortSpec,
  PortType,
  ValidateConnectionInput,
} from './node/port';
export { defaultParams, findPort, getParamSpec, outputType } from './node/definition';
export type { NodeDefinition, ParamSpec, ParamValue, SelectOption } from './node/definition';
export {
  getNodeDefinition,
  listByCategory,
  listNodeDefinitions,
  overrideNode,
  registerNode,
  requireNodeDefinition,
  subscribeRegistry,
  unregisterNode,
} from './node/registry';
export { assetNode, builtinNodes, generateNode, storyboardNode, textInputNode } from './node/builtins';

// 项目 schema
export {
  CURRENT_SCHEMA_VERSION,
  checkIntegrity,
  migrate,
  trimForSave,
  validateProjectFile,
  type IntegrityIssue,
  type MigrationIssue,
  type NodePosition,
  type NodeSize,
  type ProjectEdge,
  type ProjectFile,
  type ProjectMeta,
  type ProjectNode,
} from './schema/project';
