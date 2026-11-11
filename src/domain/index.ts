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
  type AssetOriginEdit,
  type AssetOriginUpscale,
  type CreateAssetInput,
} from './asset/model';

// 提示词里的 @资产 引用
export {
  applyAssetRefs,
  assetQueryAt,
  assetRefLabel,
  assetRefToken,
  insertAssetRef,
  parseAssetRefs,
  splitPromptSegments,
  type AssetRef,
  type AssetRefLookup,
  type AssetRefResolution,
  type PromptSegment,
} from './asset/ref';

// 裁切几何
export {
  ASPECT_PRESETS,
  MIN_CROP_SIZE,
  aspectValue,
  cropFromDrag,
  cropToPixels,
  fitAspect,
  normalizeCrop,
  normalizedRatio,
  type AspectId,
  type CropRect,
  type NormalizedPoint,
  type PixelRect,
} from './asset/crop';

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
  type CostRecord,
  type ErrorCode,
  type GenerationParams,
  type Task,
  type TaskError,
  type TaskKind,
  type TaskPhase,
  type TaskStatus,
  type TaskTransitionError,
} from './task/model';

// 成本估算
export { estimateGenerationCost, type EstimateCostInput } from './cost';

// 审计台账
export {
  auditToCsv,
  buildAuditEntries,
  filterAudit,
  summarizeAudit,
  type AuditEntry,
  type AuditFilter,
  type AuditSummary,
} from './audit/ledger';

// 一键复现
export {
  REPRO_VERSION,
  buildReproPackage,
  parseRepro,
  serializeRepro,
  validateRepro,
  type BuildReproInput,
  type ReproAsset,
  type ReproError,
  type ReproErrorCode,
  type ReproPackage,
} from './repro/model';

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
export {
  PROMPT_LONG_THRESHOLD,
  isLongPrompt,
  promptEditorState,
  promptLength,
  type PromptEditorState,
} from './node/prompt';
export {
  checkPrompt,
  checkRequiredInputs,
  localTextFor,
  resolvePrompt,
  textInputPortId,
  type ConnectionLookup,
  type MissingInput,
  type MissingInputCode,
  type ParamIssue,
} from './node/validate';
export {
  MAX_GRID_CELLS,
  gridLayout,
  parseGrid,
  type GridCellRect,
  type GridLayout,
  type GridShape,
} from './node/grid';

// 资产哈希
export { contentPath, extFromMime, sha256Hex } from './asset/hash';

// 超分契约
export {
  UPSCALE_SCALES,
  isUpscaleScale,
  upscaledSize,
  type UpscaleAdapter,
  type UpscaleAvailability,
  type UpscaleImage,
  type UpscaleRequest,
  type UpscaleScale,
  type UpscaleUnavailable,
  type UpscaleUnavailableCode,
} from './upscale/model';

// 厂商契约
export {
  canGenerate,
  capabilityAssetKind,
  modelsFor,
  storyboardPrompt,
  type GeneratedItem,
  type GenerationHandlers,
  type GenerationRequest,
  type ModelPricing,
  type ModelSpec,
  type ProviderAdapter,
  type ProviderCapability,
  type ProviderConfig,
  type ProviderScope,
} from './provider/model';

// 节点默认尺寸（新建节点与旧数据导入共用）
export { defaultNodeSize } from './node/size';

// 画布布局（对齐 / 等距 / 自动整理，UI 与导入共用一份算法）
export {
  LAYOUT_STEP_X,
  LAYOUT_STEP_Y,
  alignNodes,
  autoLayout,
  distributeNodes,
  freeBatchOffset,
  type AlignMode,
  type AutoLayoutOptions,
  type DistributeAxis,
  type PositionMap,
} from './node/layout';

// 连线语义（单路输入换源 + 错误人话化）
export {
  describePortIssue,
  describePortIssues,
  effectiveExistingEdges,
  portTypeLabel,
} from './node/connection';

// 声明式工具注册表（P1：按钮行为数据化，UI 只做解析与渲染）
export type {
  AddNodeCommand,
  MenuSection,
  ToolCategory,
  ToolContext,
  ToolDefinition,
  ToolEntry,
  ToolMode,
  ToolNodeContext,
  ToolSwitchOption,
  ToolbarId,
  ToolbarPrefs,
} from './tool/definition';
export {
  defaultToolbarPrefs,
  getToolbarTools,
  LEGACY_TOOL_IDS,
  migrateToolbarPrefs,
  registerTools,
  resetToolRegistry,
  resolveAddNodeMenuCommands,
  resolveToolbarEntries,
  resolveToolbarTools,
  unregisterTool,
} from './tool/registry';
export { CANVAS_MODE_OPTIONS, builtinTools, installBuiltinTools } from './tool/definitions';
export { canvasStarterCopy, resolveCanvasEmptyState } from './tool/canvasStarter';
export type { CanvasEmptyState, CanvasEmptyStateInput, CanvasStarterCopy } from './tool/canvasStarter';

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

// 旧版 BeastTV / INTX 数据迁移（S5）
export {
  LEGACY_CANVAS_KEY,
  LEGACY_CURRENT_KEY,
  LEGACY_PROJECT_INDEX_KEY,
  LEGACY_PROJECT_PREFIX,
  migrateLegacy,
  parseLegacyText,
  type LegacyDocument,
  type LegacyEdge,
  type LegacyMigrateOptions,
  type LegacyMigration,
  type LegacyNode,
  type LegacyNote,
  type LegacyNoteCode,
  type LegacyParseOptions,
  type LegacyReport,
  type LegacySourceKind,
} from './schema/legacy';
