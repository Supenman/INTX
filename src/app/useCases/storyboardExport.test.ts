import { beforeEach, describe, expect, it } from 'vitest';
import { builtinNodes, overrideNode } from '@/domain';
import { addNode, attachAssets, resetGraph } from '@/app/stores/graphStore';
import { GRID_GAP, buildStoryboardPng } from './storyboardExport';

/**
 * 只测不需要 Canvas 的前置校验分支。
 * 真正的拼图绘制由 e2e/specs/generation.mjs 在真实浏览器里验证 PNG 魔数与尺寸。
 */
describe('storyboardExport 前置校验', () => {
  beforeEach(() => {
    resetGraph();
    for (const d of builtinNodes) overrideNode(d);
  });

  it('节点不存在时给出可读原因', async () => {
    await expect(buildStoryboardPng('missing')).resolves.toEqual({ ok: false, message: '节点不存在' });
  });

  it('非分镜节点拒绝导出', async () => {
    const id = addNode({ defKind: 'generate', position: { x: 0, y: 0 } });
    const r = await buildStoryboardPng(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('分镜节点');
  });

  it('还没生成分格时拒绝导出', async () => {
    const id = addNode({ defKind: 'storyboard', position: { x: 0, y: 0 } });
    await expect(buildStoryboardPng(id)).resolves.toEqual({ ok: false, message: '还没有分格可导出' });
  });

  it('分格资产丢失时拒绝导出，不产出半张拼图', async () => {
    const id = addNode({ defKind: 'storyboard', position: { x: 0, y: 0 } });
    attachAssets(id, ['asset-ghost']);
    await expect(buildStoryboardPng(id)).resolves.toEqual({ ok: false, message: '分格资产已丢失' });
  });

  it('格间距是正数，拼图才看得出分格', () => {
    expect(GRID_GAP).toBeGreaterThan(0);
  });
});
