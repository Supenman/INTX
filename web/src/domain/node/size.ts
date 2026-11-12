import type { NodeSize } from '../schema/project';

/**
 * 节点默认尺寸。
 *
 * 抽到 domain 层是为了让「新建节点」和「导入旧数据」用同一份定义。
 * 之前它只是 graphStore 里的私有函数，S5 导入器一旦自己再写一份，
 * 就会出现"同一类型两处尺寸"这种迟早分叉的重复语义。
 *
 * 高度按**内容最满时**给足：节点是固定尺寸容器（画布元素的常识），
 * 出图前后不能变高。之前 generate 只给 260，没图时刚好、出图后长到 427，
 * 把下方的分镜节点盖住——用户点「拆分」实际点到了上面那张图的卡片里。
 * 这类事故在真机上表现为「点了没反应」，很难查。
 *
 * 380 是「900 高视口塞得下两行」的上限：100 + 380 + 30 + 380 = 890。
 * 再高一点，第二个节点就会落到屏幕外，用户以为没加上。
 */
export function defaultNodeSize(defKind: string): NodeSize {
  switch (defKind) {
    case 'generate':
      return { width: 340, height: 380 };
    case 'storyboard':
      return { width: 320, height: 380 };
    case 'text-input':
      return { width: 300, height: 240 };
    case 'asset':
      return { width: 300, height: 300 };
    default:
      return { width: 280, height: 240 };
  }
}
