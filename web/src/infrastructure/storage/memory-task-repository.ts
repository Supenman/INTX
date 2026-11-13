import type { TaskRepository } from '../../application/ports/taskRepository';
import { err, ok } from '../../domain/shared/result';
import { changeTask, copyTask, corruptData, type TaskSnapshot } from './task-storage';

/** 与持久化适配器相同的版本合同；快照不与调用方共享引用。 */
export function createMemoryTaskRepository(): TaskRepository {
  const snapshot: TaskSnapshot = { state: { tasks: [] }, version: 0, metadata: { formatVersion: 1, revisions: {} } };
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  return {
    async create(task) {
      const copied = copyTask(task);
      if (!copied.ok) return copied;
      const result = changeTask(snapshot, copied.value);
      return result.ok ? ok(clone(result.value)) : result;
    },
    async get(id) {
      const task = snapshot.state.tasks.find((t) => t.id === id);
      return ok(task ? { value: clone(task), revision: snapshot.metadata.revisions[id] } : null);
    },
    async list() {
      return ok(snapshot.state.tasks.map((task) => ({ value: clone(task), revision: snapshot.metadata.revisions[task.id] })));
    },
    async replace(task, expectedRevision) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return err(corruptData());
      const copied = copyTask(task);
      if (!copied.ok) return copied;
      const result = changeTask(snapshot, copied.value, expectedRevision);
      return result.ok ? ok(clone(result.value)) : result;
    },
  };
}
