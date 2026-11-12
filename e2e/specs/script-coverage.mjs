import { openPage, finish, check } from '../helpers.mjs';

/**
 * 拆分前确认文案：行数≠格数（循环复用/丢弃）与已有产物再拆分。
 *
 * confirm 用桩记录文案：既断言内容，又不与 helpers 的 dialog listener 冲突。
 * 行数=格数且无产物时不应弹确认（不打扰正常流程）。
 */
export async function run() {
  const { browser: b, page: p, errors: errs } = await openPage();

  await p.evaluate(async () => {
    window.__confirms = [];
    window.confirm = (m) => { window.__confirms.push(m); return true; };
  });

  const setup = (lines, grid) => p.evaluate(async ({ lines, grid }) => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    g.resetGraph();
    const text = g.addNode({ defKind: 'text-input', position: { x: 80, y: 80 } });
    const sb = g.addNode({ defKind: 'storyboard', position: { x: 520, y: 80 } });
    g.setNodeParam(text, 'content', lines);
    g.setNodeParam(sb, 'grid', grid);
    g.connectNodes({ sourceNodeId: text, sourcePortId: 'text', targetNodeId: sb, targetPortId: 'script' });
    window.__confirms = [];
  }, { lines, grid });

  const clickSplit = async () => {
    await p.locator('.react-flow__node').nth(1).locator('.node-generate-btn').click();
    await p.waitForTimeout(300);
  };
  const confirms = () => p.evaluate(() => window.__confirms);
  const waitTerminal = async (timeoutMs = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const done = await p.evaluate(async () => {
        const t = await window.__intxMod('/src/app/stores/taskStore.ts');
        const tasks = Object.values(t.useTaskStore.getState().tasks);
        const last = tasks[tasks.length - 1];
        return !last || ['succeeded', 'failed', 'canceled'].includes(last.status);
      });
      if (done) return;
      await p.waitForTimeout(400);
    }
  };

  // ── 1. 3 行 / 2x2（4 格）→ 循环复用提示 ──
  await setup('一\n二\n三', '2x2');
  await p.waitForTimeout(300);
  await clickSplit();
  let c = await confirms();
  check(c.length === 1, `3 行 4 格应弹一次确认，实际 ${c.length}`);
  check(c[0].includes('循环复用'), `应提示循环复用，实际「${c[0]}」`);
  await waitTerminal();

  // ── 2. 5 行 / 2x2 → 丢弃提示 ──
  await setup('一\n二\n三\n四\n五', '2x2');
  await p.waitForTimeout(300);
  await clickSplit();
  c = await confirms();
  check(c.length === 1 && c[0].includes('不会生成'), `5 行 4 格应提示多余行不会生成，实际 ${JSON.stringify(c)}`);
  await waitTerminal();

  // ── 3. 4 行 / 2x2 且无产物 → 不弹确认 ──
  await setup('一\n二\n三\n四', '2x2');
  await p.waitForTimeout(300);
  await clickSplit();
  c = await confirms();
  check(c.length === 0, `行数=格数且无产物不应弹确认，实际 ${JSON.stringify(c)}`);
  await waitTerminal();

  // ── 4. 已有产物再拆分 → 全新生成 + 保留在资产库 ──
  // 上一轮已出 4 格，直接再点拆分
  await p.evaluate(() => { window.__confirms = []; });
  await clickSplit();
  c = await confirms();
  check(c.length === 1, `已有产物再拆分应弹确认，实际 ${c.length}`);
  check(c[0].includes('全新生成'), `应提示全新生成，实际「${c[0]}」`);
  check(c[0].includes('保留在资产库'), `应提示已有产物保留在资产库，实际「${c[0]}」`);

  // ── 5. 取消确认 → 不发起生成 ──
  await waitTerminal();
  await p.evaluate(() => {
    window.__confirms = [];
    window.confirm = () => false; // 这次拒绝
  });
  const callsBefore = await p.evaluate(async () => {
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    return Object.keys(t.useTaskStore.getState().tasks).length;
  });
  await clickSplit();
  const callsAfter = await p.evaluate(async () => {
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    return Object.keys(t.useTaskStore.getState().tasks).length;
  });
  check(callsAfter === callsBefore, '拒绝确认后不应新建任务');

  finish('拆分确认文案', errs);
  await b.close();
}
