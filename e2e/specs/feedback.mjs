import { openPage, finish, check } from '../helpers.mjs';

/**
 * 反馈层级：toast（短暂确认）与 alert（需处理的错误）各管各的。
 *
 * 锁三件事：
 * 1. 成功动作用 role=status + aria-live=polite 的 toast，不打断操作。
 * 2. 错误用 role=alert 的常驻条，可手动关闭，不冒充 toast。
 * 3. 节点内任务失败不升到画布级 alert（一个节点失败不该整屏弹红条）。
 */
export async function run() {
  const { browser: b, page: p, errors: errs } = await openPage();

  // ── 1. 复制节点 → toast（role=status, aria-live=polite） ──
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    g.resetGraph();
    g.addNode({ defKind: 'generate', position: { x: 120, y: 120 } });
  });
  await p.waitForTimeout(400);
  await p.locator('.react-flow__node').first().locator('.node-head').click();
  await p.keyboard.press('Control+d');
  await p.waitForTimeout(250);
  const toast = p.locator('.chip.toast');
  check((await toast.count()) === 1, '复制后应出现 toast');
  check((await toast.getAttribute('role')) === 'status', 'toast 应是 role=status');
  check((await toast.getAttribute('aria-live')) === 'polite', 'toast 应是 aria-live=polite');
  check((await toast.innerText()).includes('已复制'), 'toast 文案应是复制确认');
  // toast 自动消失
  await p.waitForTimeout(2600);
  check((await toast.count()) === 0, 'toast 应在约 2.4s 后自动消失');

  // ── 2. 连线被拒 → alert（role=alert），可手动关闭 ──
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    g.resetGraph();
    g.addNode({ defKind: 'asset', position: { x: 120, y: 120 } });
    g.addNode({ defKind: 'generate', position: { x: 560, y: 120 } });
  });
  await p.waitForTimeout(400);
  // 素材(image) → 生成(prompt 只收 text)：类型不匹配，拖拽连线被拒
  const nodes = p.locator('.react-flow__node');
  const from = await nodes.nth(0).locator('.react-flow__handle.source').first().boundingBox();
  const to = await nodes.nth(1).locator('.react-flow__handle.target').first().boundingBox();
  await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await p.mouse.down();
  await p.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(400);
  const alert = p.locator('.conn-error[role="alert"]');
  check((await alert.count()) === 1, '连线被拒应出现 role=alert 的错误条');
  check((await p.locator('.chip.toast').count()) === 0, '错误不应冒充 toast');
  // 手动关闭
  await alert.locator('button[aria-label="关闭"]').click();
  await p.waitForTimeout(200);
  check((await alert.count()) === 0, '点关闭应移除错误条');

  // ── 3. 节点任务失败不升到画布级 alert ──
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    const nodeId = Object.keys(g.useGraphStore.getState().nodes).find(
      (id) => g.useGraphStore.getState().nodes[id].defKind === 'generate',
    );
    t.useTaskStore.setState({ tasks: {} });
    const id = t.submitTask({
      kind: 'image',
      params: { kind: 'image', prompt: 'x', model: 'demo/image', providerId: 'demo', inputAssetIds: [], aspectRatio: '1:1' },
      nodeId,
    });
    t.markRunning(id);
    t.markFailed(id, { code: 'timeout', message: '模拟超时' });
  });
  await p.waitForTimeout(300);
  check((await p.locator('.node-status.failed').count()) === 1, '失败应留在节点状态行');
  check((await p.locator('.conn-error[role="alert"]').count()) === 0, '节点失败不应弹画布级 alert');

  // ── 4. 空画布起始框文案由 domain 决策（演示模式如实标注） ──
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    g.resetGraph();
  });
  await p.waitForTimeout(400);
  const starter = p.locator('.canvas-starter');
  check((await starter.count()) === 1, '空画布应显示起始框');
  const starterText = await starter.innerText();
  check(starterText.includes('不出真图'), '演示模式起始框应如实标注「不出真图」');

  finish('反馈层级', errs);
  await b.close();
}
