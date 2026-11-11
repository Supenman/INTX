import { useCallback } from 'react';
import { getNodeDefinition } from '@/domain';
import { connectNodes, useGraphStore } from '@/app/stores/graphStore';

/**
 * 批量连接：按坐标从左到右，把相邻节点的第一个可用端口连起来。
 *
 * 从 Canvas.tsx 里拆出来的。原因不是"文件太长不好看"——是 Canvas 已经贴着
 * 800 行的结构预算上限，而这段逻辑本身和 Canvas 的渲染毫无关系，它只依赖
 * 选中的 id 和 store。留在一个 800 行组件里，下一次改画布布局的人得先读一遍
 * 连线算法，纯属干扰。
 *
 * 顺序按 x 而不是点击顺序：用户说的「按顺序连起来」指的是画布上的排列顺序。
 */
export function useChainSelection(selectedIds: string[], onDone: (message: string) => void): () => void {
  return useCallback(() => {
    const { nodes } = useGraphStore.getState();
    const ordered = selectedIds
      .filter((id) => nodes[id])
      .sort((a, b) => (nodes[a]?.position.x ?? 0) - (nodes[b]?.position.x ?? 0));
    let linked = 0;
    for (let i = 0; i + 1 < ordered.length; i += 1) {
      const src = nodes[ordered[i] ?? ''];
      const dst = nodes[ordered[i + 1] ?? ''];
      if (!src || !dst) continue;
      const sourcePort = getNodeDefinition(src.defKind)?.outputPorts[0];
      const targetPort = getNodeDefinition(dst.defKind)?.inputPorts[0];
      if (!sourcePort || !targetPort) continue;
      const r = connectNodes({
        sourceNodeId: src.id,
        sourcePortId: sourcePort.id,
        targetNodeId: dst.id,
        targetPortId: targetPort.id,
      });
      if (r.ok) linked += 1;
    }
    onDone(linked > 0 ? `已连接 ${linked} 组相邻节点` : '这些节点之间没有可用的端口组合');
  }, [selectedIds, onDone]);
}
