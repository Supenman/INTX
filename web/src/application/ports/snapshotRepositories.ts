import type { Result } from '../../domain/shared/result';
import type { Asset, CanvasDeletedProject, CanvasProject } from '../persistence/types';
import type { StorageError, Stored } from './taskRepository';

export type ProjectSnapshot = { projects: CanvasProject[]; deletedProjects: CanvasDeletedProject[] };
export type AssetSnapshot = { assets: Asset[] };

export interface ProjectRepository {
  load(): Promise<Result<Stored<ProjectSnapshot>, StorageError>>;
  save(value: ProjectSnapshot, expectedRevision: number): Promise<Result<Stored<ProjectSnapshot>, StorageError>>;
}
export interface AssetRepository {
  load(): Promise<Result<Stored<AssetSnapshot>, StorageError>>;
  save(value: AssetSnapshot, expectedRevision: number): Promise<Result<Stored<AssetSnapshot>, StorageError>>;
}
