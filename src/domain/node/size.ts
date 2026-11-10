import type { NodeSize } from '../schema/project';

/**
 * 节点默认尺寸。
 *
 * 抽到 domain 层是为了让「新建节点」和「导入旧数据」用同一份定义。
 * 之前它只是 graphStore 里的私有函数，S5 导入器一旦自己再写一份，
 * 就会出现"同一类型两处尺寸"这种迟早分叉的重复语义。
 */
export function defaultNodeSize(defKind: string): NodeSize {
  switch (defKind) {
    case 'generate':
      return { width: 340, height: 260 };
    case 'storyboard':
      return { width: 320, height: 320 };
    case 'text-input':
      return { width: 300, height: 220 };
    default:
      return { width: 280, height: 220 };
  }
}
