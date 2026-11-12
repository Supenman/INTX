import { openPage, finish, check } from '../helpers.mjs';

/**
 * 单格重发（cellIndex）：只替换第 N 格，其余格不动，上游只多 1 次调用。
 * 以及 canceled 态的补格入口真的能续跑。
 */
export async function run() {
  const { browser: b, page: p, errors: errs } = await openPage();

  await p.evaluate(async () => {
    window.__confirms = [];
    window.confirm = (m) => { window.__confirms.push(m); return true; };
    const prov = await window.__intxMod('/src/infra/provider/index.ts');
    const orig = prov.mockAdapter;
    window.__genCalls = [];
    window.__perturb = false;
    prov.registerAdapter('mock', {
      kind: 'mock',
      test: (c) => orig.test(c),
      generate: async (config, request, handlers) => {
        window.__genCalls.push(request.prompt);
        const items = await orig.generate(config, request, handlers);
        // 演示适配器是确定性的：同提示词必出同字节，内容寻址去重会把重发
        // 的图折回同一个资产 ID，「替换」就观察不到（真实厂商每次出图字节
        // 不同，不存在这个问题）。这里扰动一次字节，模拟真实厂商行为。
        if (window.__perturb) {
          window.__perturb = false;
          const b = new Uint8Array(items[0].bytes);
          b[b.length - 1] ^= 0xff;
          items[0] = { ...items[0], bytes: b.buffer };
        }
        return items;
      },
    });
  });

  const sbState = () => p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const sb = Object.values(g.useGraphStore.getState().nodes).find((n) => n.defKind === 'storyboard');
    return { id: sb?.id, derived: [...(sb?.derivedAssetIds ?? [])], calls: window.__genCalls.length };
  });

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

  // ── 0. 2x2 四格跑满 ──
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    g.resetGraph();
    const text = g.addNode({ defKind: 'text-input', position: { x: 80, y: 80 } });
    const sb = g.addNode({ defKind: 'storyboard', position: { x: 520, y: 80 } });
    g.setNodeParam(text, 'content', '一\n二\n三\n四');
    g.connectNodes({ sourceNodeId: text, sourcePortId: 'text', targetNodeId: sb, targetPortId: 'script' });
  });
  await p.waitForTimeout(400);
  await p.locator('.react-flow__node').nth(1).locator('.node-generate-btn').click();
  await waitTerminal();
  let s = await sbState();
  check(s.derived.length === 4, `应出 4 格，实际 ${s.derived.length}`);
  const slot2Before = s.derived[2];
  const callsBefore = s.calls;

  // ── 1. 单格重发第 3 格：只换 slot2，上游 +1 ──
  await p.evaluate(() => { window.__perturb = true; });
  const cell = p.locator('.grid-cell').nth(2);
  await cell.hover();
  await p.waitForTimeout(200);
  await cell.locator('.grid-cell-retry').click();
  await waitTerminal();
  s = await sbState();
  check(s.derived.length === 4, `单格重发后仍应 4 格（替换不追加），实际 ${s.derived.length}`);
  check(s.derived[2] !== slot2Before, '第 3 格产物应被替换');
  check(s.derived[0] === (await sbState()).derived[0], '第 1 格不应动');
  check(s.calls === callsBefore + 1, `单格重发应只多 1 次上游调用，实际 ${s.calls - callsBefore}`);
  // 快照 count=1、extras.cell=2
  const snap = await p.evaluate(async () => {
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    const tasks = Object.values(t.useTaskStore.getState().tasks);
    const last = tasks[tasks.length - 1];
    return { count: last?.params.count, cell: last?.params.extras?.cell };
  });
  check(snap.count === 1, `单格任务快照 count 应为 1，实际 ${snap.count}`);
  check(snap.cell === 2, `快照 extras.cell 应为 2，实际 ${snap.cell}`);

  // ── 2. canceled 态补格入口：制造 2/4 格取消，点继续补齐跑满 ──
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    const sb = Object.values(g.useGraphStore.getState().nodes).find((n) => n.defKind === 'storyboard');
    // 截到 2 格模拟跑一半取消
    g.attachAssets(sb.id, sb.derivedAssetIds.slice(0, 2));
    t.useTaskStore.setState({ tasks: {} });
    const id = t.submitTask({
      kind: 'image',
      params: { kind: 'image', prompt: '一\n二\n三\n四', model: 'demo/image', providerId: 'demo', inputAssetIds: [], aspectRatio: '1:1', extras: { grid: '2x2', style: '' } },
      nodeId: sb.id,
    });
    t.markRunning(id);
    t.markCanceled(id, []);
  });
  await p.waitForTimeout(300);
  const resumeBtn = p.locator('.node-status.canceled .link-btn');
  check((await resumeBtn.count()) === 1, 'canceled 且 2<4 格应有继续补齐按钮');
  await resumeBtn.click();
  await waitTerminal();
  s = await sbState();
  check(s.derived.length === 4, `继续补齐后应跑满 4 格，实际 ${s.derived.length}`);

  finish('单格重发与取消补格', errs);
  await b.close();
}
