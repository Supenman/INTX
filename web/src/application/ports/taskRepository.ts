import type { Result } from '../../domain/shared/result';
import type { Task } from '../../domain/task/model';

export type Stored<T> = { value: T; revision: number };

export type StorageError =
  | { code: 'unavailable' | 'read_failed' | 'write_failed'; message: string }
  | { code: 'corrupt_data' | 'unsupported_format'; message: string }
  | { code: 'conflict'; message: string; expectedRevision: number; actualRevision: number }
  | { code: 'not_found' | 'already_exists'; message: string; id: string };

export interface TaskRepository {
  create(task: Task): Promise<Result<Stored<Task>, StorageError>>;
  get(id: string): Promise<Result<Stored<Task> | null, StorageError>>;
  list(): Promise<Result<Stored<Task>[], StorageError>>;
  replace(task: Task, expectedRevision: number): Promise<Result<Stored<Task>, StorageError>>;
}
