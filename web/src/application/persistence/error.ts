import type { StorageError } from '@/application/ports/taskRepository';

/** 本地存储失败，不参与厂商错误分类或重新提交。 */
export class SnapshotPersistenceError extends Error {
    readonly name = 'SnapshotPersistenceError';
    constructor(readonly detail: StorageError) { super(detail.message); }
}
