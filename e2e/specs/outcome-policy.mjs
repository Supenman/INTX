import { openPage, finish, check } from '../helpers.mjs';

/**
 * 失败态三态重发策略（照 BeefTV task-outcome 的判定骨架移植的那块）。
 *
 * 单测能证明「某个错误码映射到 allowed / confirm / blocked」，证明不了
 * 「卡片上真的渲染出了对应的按钮文字」和「点下去任务真的回到 queued」。
 * 这一组只测这两件事，以及「任务还在跑时不给重发按钮」。
 */
const CASES = [
  { code: 'submission_uncertain', badge: '?', action: '确认没过，可重发' },
  { code: 'local_save_failed', badge: '?', action: '清完磁盘再重发' },
  { code: 'auth_failed', badge: '✕', action: '改好配置再重发' },
  { code: 'content_rejected', badge: '✕', action: '改提示词再重发' },
  { code: 'timeout', badge: '✕', action: '重置状态' },
];

export async function run() {
  const { browser: b, page: p, errors: errs } = await openPage();

  const nodeId = await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const existing = Object.values(g.useGraphStore.getState().nodes).find((n) => n.defKind === 'generate');
    return existing ? existing.id : g.addNode({ defKind: 'generate', position: { x: 120, y: 120 } });
  });
  check(!!nodeId, '应有一个生成节点');

  /** 造一个指定错误码的失败任务；extra.running 时停在 running 不失败。 */
  const inject = (code, extra = {}) =>
    p.evaluate(
      async ({ code, extra, nodeId }) => {
        const t = await window.__intxMod('/src/app/stores/taskStore.ts');
        t.useTaskStore.setState({ tasks: {} });
        // GenerationParams 是显式字段的快照，freezeParams 会展开 inputAssetIds，
        // 少一个字段就在运行时炸。照生产代码（runGeneration.ts）的形状给全。
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
        if (extra.running) return id;
        t.markFailed(id, { code, message: '模拟失败：' + code, retryable: false });
        if (extra.results) {
          const s = t.useTaskStore.getState();
          t.useTaskStore.setState({
            tasks: { ...s.tasks, [id]: { ...s.tasks[id], resultAssetIds: extra.results } },
          });
        }
        return id;
      },
      { code, extra, nodeId },
    );

  // ── 1. 每个错误码的真实渲染 ──
  for (const c of CASES) {
    await inject(c.code);
    await p.waitForTimeout(180);
    const box = p.locator('.node-status.failed').first();
    const text = (await box.innerText()).trim();
    check(text.startsWith(c.badge), `${c.code} 前缀应为 ${c.badge}，实际「${text}」`);
    const btn = box.locator('.link-btn');
    check((await btn.count()) === 1, `${c.code} 应有一个重发按钮`);
    check((await btn.innerText()).trim() === c.action, `${c.code} 按钮文案应为「${c.action}」`);
  }

  // ── 2. 真实点击后果：confirm 态也能把任务重置回队列 ──
  await inject('submission_uncertain');
  await p.waitForTimeout(180);
  await p.locator('.node-status.failed .link-btn').first().click();
  await p.waitForTimeout(220);
  const afterClick = await p.evaluate(async () => {
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    return Object.values(t.useTaskStore.getState().tasks).map((x) => x.status);
  });
  check(afterClick.length === 1 && afterClick[0] === 'queued', `点确认后应回到 queued，实际 ${JSON.stringify(afterClick)}`);

  // ── 3. 分镜部分成功：已出的图已经计费，按钮要写明 ──
  await inject('timeout', { results: ['as_1', 'as_2'] });
  await p.waitForTimeout(180);
  const partial = await p.locator('.node-status.failed .link-btn').first().innerText();
  check(partial.includes('已出的保留'), `部分成功应提示已出的保留，实际「${partial}」`);

  // ── 4. blocked：任务还在跑时不给任何重发按钮 ──
  await inject('timeout', { running: true });
  await p.waitForTimeout(180);
  const runningBtn = await p.locator('.node-status .link-btn').count();
  check(runningBtn === 0, `running 时不应出现重发按钮，实际 ${runningBtn} 个`);
  const blockedDirect = await p.evaluate(async () => {
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    const id = Object.keys(t.useTaskStore.getState().tasks)[0];
    return t.retryTask(id);
  });
  check(blockedDirect === false, 'store 层也应拦住 running 任务的直接 retryTask');

  finish('三态重发策略', errs);
  await b.close();
}
