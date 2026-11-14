/** 任务层统一出口。基座 api 层只从这里取薄壳与留证工具。 */
export {
  ProviderResultPendingError,
  classifyImagePayload,
  describePayload,
  hasImageData,
  isExplicitRejection,
  pendingResultFrom,
  readTaskIdFromMessage,
  readUpstreamTaskId,
} from './pendingResult';

export {
  GenerationTaskError,
  inspectRunWithTask,
  runWithTask,
  type RunWithTaskInput,
  type SubmitHooks,
  type TaskRunResult,
} from './withTask';

export {
  MODELSCOPE_MAX_WAIT_MS,
  MODELSCOPE_POLL_INTERVAL_MS,
  generateModelScopeImages,
  isModelScopeEndpoint,
  modelScopeApiBase,
  pollModelScopeTask,
  type ModelScopeImage,
  type ModelScopeRequest,
  type ModelScopeTransport,
  type TransportResponse,
} from './modelScope';

export {
  TASK_LOG_KEY,
  browserTaskLog,
  commit,
  commitRecovered,
  createMemoryTaskLog,
  createTaskLog,
  forgetRecoveredAssets,
  forgetPendingCommit,
  isTaskCommitted,
  loadTaskLog,
  pendingCommitFor,
  recoveredAssetIds,
  rememberRecoveredAssets,
  rememberPendingCommit,
  restorePendingCommits,
  restoreUnsaved,
  retryTaskSave,
  TaskPersistenceError,
  type LoggedTask,
  type UnsavedTask,
  resumableTasks,
  useTaskLogStore,
  type TaskLog,
} from './taskLog';

export {
  createMemoryEvidenceStore,
  parseEvidence,
  setEvidenceStore,
  type EvidenceStore,
  type TaskEvidence,
} from './taskEvidence';

export {
  createMemoryRecoveredAssetEvidenceStore,
  parseRecoveredAssetEvidence,
  setRecoveredAssetEvidenceStore,
  type RecoveredAssetEvidence,
  type RecoveredAssetEvidenceStore,
} from './recoveredAssetEvidence';

export {
  pickModelScopeChannel,
  recoveryAction,
  type RecoveryAction,
  type RecoveryChannelView,
} from './taskRecovery';

export { imageTaskParams, type ImageConfigView } from './imageParams';

export {
  MAX_IMAGE_SLOTS,
  imageSlotCount,
  runImageSlots,
  type ImageSlotOutcome,
  type RunImageSlotsInput,
} from './imageSlots';

export {
  noteVideoPoll,
  resumableVideoTasks,
  submitVideoTask,
  videoHandleFromTask,
  videoTaskParams,
  type VideoConfigView,
  type VideoPollState,
  type VideoTaskHandle,
  type VideoTransport,
} from './videoTasks';
