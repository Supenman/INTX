import { readFileSync } from 'node:fs';
import { openPage, finish, check, OUTPUT_DIR } from '../helpers.mjs';

/**
 * generate 多张生成 + 结果浏览 + 选主图 + 另存。
 *
 * 管道两侧早已支持 count，本批补上节点参数与 UI。锁：
 * count=3 → 主图区单张 + 缩略图 3；点第 2 张设主图（下游取这张）；
 * 另存下载有效 PNG；快照 count=3；刷新后主图与缩略图还原。
 */
const PNG_MAGIC = '89504e470d0a1a0a';

export async function run() {
  const { browser: b, context: ctx, page: p, errors: errs } = await openPage();

  await p.evaluate(async () => {
    window.__confirms = [];
    window.confirm = (m) => { window.__confirms.push(m); return true; };
  });

  // ── 0. 文字 → generate，count=3 ──
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    g.resetGraph();
    const text = g.addNode({ defKind: 'text-input', position: { x: 80, y: 80 } });
    const gen = g.addNode({ defKind: 'generate', position: { x: 520, y: 80 } });
    g.setNodeParam(text, 'content', '雨后的巷口');
    g.setNodeParam(gen, 'count', '3');
    g.connectNodes({ sourceNodeId: text, sourcePortId: 'text', targetNodeId: gen, targetPortId: 'prompt' });
  });
  await p.waitForTimeout(400);
  await p.locator('.react-flow__node').nth(1).locator('.node-generate-btn').click();
  await p.waitForTimeout(6000);

  const genCard = p.locator('.react-flow__node').nth(1);
  // 主图区只留单张（generation e2e 的不变式），缩略图条在外面
  check((await genCard.locator('.node-result img').count()) === 1, '主图区应只有单张');
  check((await genCard.locator('.result-thumb').count()) === 3, 'count=3 应有 3 个缩略图');

  const state1 = await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const gen = Object.values(g.useGraphStore.getState().nodes).find((n) => n.defKind === 'generate');
    return { assetId: gen?.assetId, derived: [...(gen?.derivedAssetIds ?? [])] };
  });
  check(state1.derived.length === 3, `应产出 3 张，实际 ${state1.derived.length}`);
  check(state1.assetId === state1.derived[0], '默认主图应是第一张');

  // ── 1. 点第 2 张设主图 ──
  await genCard.locator('.result-thumb').nth(1).click();
  await p.waitForTimeout(300);
  const state2 = await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const gen = Object.values(g.useGraphStore.getState().nodes).find((n) => n.defKind === 'generate');
    return { assetId: gen?.assetId, derived: [...(gen?.derivedAssetIds ?? [])] };
  });
  check(state2.assetId === state2.derived[1], '点第 2 张后主图应是 derived[1]');
  check(state2.derived.length === 3, '选主图不应动产物列表');
  check((await genCard.locator('.result-thumb.active').count()) === 1, '应有且仅有一个激活缩略图');

  // ── 2. 另存主图：有效 PNG ──
  const [download] = await Promise.all([
    p.waitForEvent('download'),
    genCard.locator('.result-save').click({ force: true }),
  ]);
  const path = await download.path();
  const buf = readFileSync(path);
  check(buf.subarray(0, 8).toString('hex') === PNG_MAGIC, '另存的应是有效 PNG');
  check(buf.length > 1000, '另存文件应有实际内容');

  // ── 3. 快照 count=3 ──
  const snapCount = await p.evaluate(async () => {
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    const tasks = Object.values(t.useTaskStore.getState().tasks);
    return tasks[tasks.length - 1]?.params.count;
  });
  check(snapCount === 3, `任务快照 count 应为 3，实际 ${snapCount}`);

  // ── 4. 刷新后主图与缩略图还原 ──
  await p.waitForTimeout(1200);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const restored = await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const gen = Object.values(g.useGraphStore.getState().nodes).find((n) => n.defKind === 'generate');
    return { assetId: gen?.assetId, derived: [...(gen?.derivedAssetIds ?? [])] };
  });
  check(restored.assetId === state2.derived[1], '刷新后主图应仍是选定的第 2 张');
  check(restored.derived.length === 3, '刷新后应仍有 3 张产物');
  check((await p.locator('.react-flow__node').nth(1).locator('.result-thumb').count()) === 3, '刷新后缩略图条应还原');

  await p.screenshot({ path: OUTPUT_DIR + 'multi-result.png' });
  finish('多张生成与选主图', errs);
  await b.close();
}
