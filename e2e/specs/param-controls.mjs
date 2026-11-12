import { openPage, finish, check } from '../helpers.mjs';

/**
 * 节点参数编辑控件：select/input 从只读展示换成可编辑控件之后，
 * 要锁住的是「改得动、存得住、撤得回、跑任务时锁得上」四件事。
 *
 * 选项列表以节点定义为唯一来源（builtins），这里断言的是渲染与联动，
 * 不重复测选项内容本身。「busy 禁用」用 outcome-policy 同款任务注入：
 * running 任务窗口稳定可控，不依赖 mock 适配器的时序。
 */
export async function run() {
  const { browser: b, page: p, errors: errs } = await openPage();

  // ── 0. 准备：一个 generate、一个 storyboard，清空历史 ──
  const ids = await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const h = await window.__intxMod('/src/app/stores/historyStore.ts');
    g.resetGraph();
    const gen = g.addNode({ defKind: 'generate', position: { x: 120, y: 120 } });
    const sb = g.addNode({ defKind: 'storyboard', position: { x: 560, y: 120 } });
    h.clearHistory();
    return { gen, sb };
  });
  check(!!ids.gen && !!ids.sb, '应建好 generate 与 storyboard 两个节点');

  const paramOf = (nodeId, key) =>
    p.evaluate(
      async ({ nodeId, key }) => {
        const g = await window.__intxMod('/src/app/stores/graphStore.ts');
        return g.useGraphStore.getState().nodes[nodeId]?.params[key];
      },
      { nodeId, key },
    );

  const genCard = p.locator('.react-flow__node', { has: p.locator('select[aria-label="产出"]') }).first();
  const sbCard = p.locator('.react-flow__node', { has: p.locator('select[aria-label="宫格"]') }).first();

  // ── 1. generate：产出类型可改，非 image 时给出能力提示 ──
  await genCard.locator('select[aria-label="产出"]').selectOption('video');
  check((await paramOf(ids.gen, 'outputKind')) === 'video', '选 video 应写入 params.outputKind');
  const hint = genCard.locator('.node-empty', { hasText: '不会产出对应媒体' });
  check((await hint.count()) === 1, '选 video 应出现「演示厂商只出图片」提示');
  await genCard.locator('select[aria-label="产出"]').selectOption('image');
  check((await paramOf(ids.gen, 'outputKind')) === 'image', '应能改回 image');

  // ── 2. generate：宽高比可改 ──
  await genCard.locator('select[aria-label="宽高比"]').selectOption('16:9');
  check((await paramOf(ids.gen, 'aspectRatio')) === '16:9', '宽高比应写入 params');

  // ── 3. storyboard：宫格与单格比例可改 ──
  await sbCard.locator('select[aria-label="宫格"]').selectOption('1x4');
  check((await paramOf(ids.sb, 'grid')) === '1x4', '宫格应写入 params.grid');
  await sbCard.locator('select[aria-label="单格比例"]').selectOption('9:16');
  check((await paramOf(ids.sb, 'aspectRatio')) === '9:16', '单格比例应写入 params');

  // ── 4. storyboard：画风文本可编辑（此前完全没有入口） ──
  const styleInput = sbCard.locator('input[aria-label="画风"]');
  await styleInput.click();
  await styleInput.fill('赛璐璐动画');
  check((await paramOf(ids.sb, 'style')) === '赛璐璐动画', '画风应写入 params.style');

  // ── 5. 输入框内打字/删除不穿透画布快捷键 ──
  await styleInput.press('Backspace');
  const aliveAfterBackspace = await p.evaluate(async (nodeId) => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    return !!g.useGraphStore.getState().nodes[nodeId];
  }, ids.sb);
  check(aliveAfterBackspace, '输入框内 Backspace 不应删掉节点');
  await styleInput.fill('赛璐璐动画');

  // ── 6. 撤销：先离开输入框，Ctrl+Z 逐步回退 ──
  await p.locator('.react-flow__pane').click({ position: { x: 30, y: 400 } });
  await p.keyboard.press('Control+z'); // 撤画风文本（连续打字合并为一步）
  check((await paramOf(ids.sb, 'style')) === '', '第一次撤销应回到画风空值');
  await p.keyboard.press('Control+z'); // 撤单格比例
  check((await paramOf(ids.sb, 'aspectRatio')) === '1:1', '第二次撤销应回默认单格比例');
  await p.keyboard.press('Control+z'); // 撤宫格
  check((await paramOf(ids.sb, 'grid')) === '2x2', '第三次撤销应回默认宫格');
  await p.keyboard.press('Control+Shift+z'); // 重做宫格
  check((await paramOf(ids.sb, 'grid')) === '1x4', '重做应恢复宫格修改');

  // ── 7. busy 禁用：running 任务期间参数锁死，结束后恢复 ──
  await p.evaluate(async (nodeId) => {
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    t.useTaskStore.setState({ tasks: {} });
    const id = t.submitTask({
      kind: 'image',
      params: {
        kind: 'image',
        prompt: 'test',
        model: 'demo/image',
        providerId: 'demo',
        inputAssetIds: [],
        aspectRatio: '1:1',
      },
      nodeId,
    });
    t.markRunning(id);
  }, ids.gen);
  await p.waitForTimeout(200);
  const genSelect = genCard.locator('select[aria-label="产出"]');
  check(await genSelect.isDisabled(), 'running 时产出 select 应禁用');
  check(await genCard.locator('select[aria-label="宽高比"]').isDisabled(), 'running 时宽高比 select 应禁用');

  await p.evaluate(async () => {
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    const id = Object.keys(t.useTaskStore.getState().tasks)[0];
    t.markSucceeded(id, []);
  });
  await p.waitForTimeout(200);
  check(!(await genSelect.isDisabled()), '任务结束后 select 应恢复可用');

  finish('参数编辑控件', errs);
  await b.close();
}
