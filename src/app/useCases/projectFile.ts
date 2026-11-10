import type { ProjectFile } from '@/domain';
import { DEFAULT_PROJECT_ID, indexedDbRepository } from '@/infra/repository/projectRepository';

/**
 * 项目文件的读取入口。
 *
 * 单独抽出来，是因为「恢复资产索引」与「恢复画布」都需要同一个文件，
 * 但它们发生在不同的时机（资产索引要早于节点渲染，否则缩略图会闪一下空白）。
 */
export async function loadProjectFile(id = DEFAULT_PROJECT_ID): Promise<ProjectFile | null> {
  return indexedDbRepository.load(id);
}
