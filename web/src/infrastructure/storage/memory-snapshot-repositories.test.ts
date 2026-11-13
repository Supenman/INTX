import { createMemoryAssetRepository, createMemoryProjectRepository } from './memory-snapshot-repositories';
import { sampleAssets, sampleProjects, snapshotRepositoryContract } from './snapshot-repositories.contract';

snapshotRepositoryContract('memory projects', createMemoryProjectRepository, { projects: [], deletedProjects: [] }, sampleProjects);
snapshotRepositoryContract('memory assets', createMemoryAssetRepository, { assets: [] }, sampleAssets);
