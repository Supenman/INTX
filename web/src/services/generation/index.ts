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
  type TaskRunResult,
} from './withTask';

export {
  TASK_LOG_KEY,
  browserTaskLog,
  commit,
  createMemoryTaskLog,
  resumableTasks,
  useTaskLogStore,
  type TaskLog,
} from './taskLog';

export { imageTaskParams, type ImageConfigView } from './imageParams';

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
