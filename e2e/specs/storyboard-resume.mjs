import { openPage, finish, check } from '../helpers.mjs';

/**
 * 分镜补格计划（planStoryboardResume 三分支）的浏览器后果。
 *
 * 锁两条真实路径：
 * 1. 截断：6 格产物 + 缩格到 2x2 后点重发 → 保留前 4 格、不发请求、不建任务。
 *    构造走真实可达链：全新一批首格失败 → 0 产出 → 旧 derived 原样留在节点。
 * 2. 漂移拒绝：参数变了再补格 → AlertBanner 提示「参数已变」、无新任务。
 *
 * confirm 用桩（记录文案并放行），避免与 helpers 的 dialog listener 冲突。
 */
export async function run() {
  const { browser: b, page: p, errors: errs } = await openPage();

  // confirm 桩 + 可计数/可注入失败的适配器
  await p.evaluate(async () => {
    window.__confirms = [];
    window.confirm = (m) => { window.__confirms.push(m); return true; };
    const prov = await window.__intxMod('/src/infra/provider/index.ts');
    const orig = prov.mockAdapter;
    window.__genCalls = [];
    window.__failCall = null;
    prov.registerAdapter('mock', {
      kind: 'mock',
      test: (c) => orig.test(c),
      generate: async (config, request, handlers) => {
        window.__genCalls.push(request.prompt);
        if (window.__failCall !== null && window.__genCalls.length === window.__failCall) {
          throw new Error('429 rate limit exceeded');
        }
        return orig.generate(config, request, handlers);
      },
    });
  });

  const sbState = () => p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    const sb = Object.values(g.useGraphStore.getState().nodes).find((n) => n.defKind === 'storyboard');
    return {
      id: sb?.id,
      derived: sb?.derivedAssetIds?.length ?? 0,
      tasks: Object.keys(t.useTaskStore.getState().tasks).length,
      calls: window.__genCalls.length,
    };
  });

  // mock 每格约 2s，6 格要 ~12s；轮询等终态而不是写死短超时
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

  // ── 0. 摆图：文字(6行) → 分镜 3x2，跑满 6 格 ──
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    g.resetGraph();
    const text = g.addNode({ defKind: 'text-input', position: { x: 80, y: 80 } });
    const sb = g.addNode({ defKind: 'storyboard', position: { x: 520, y: 80 } });
    g.setNodeParam(text, 'content', '一\n二\n三\n四\n五\n六');
    g.setNodeParam(sb, 'grid', '3x2');
    g.connectNodes({ sourceNodeId: text, sourcePortId: 'text', targetNodeId: sb, targetPortId: 'script' });
  });
  await p.waitForTimeout(400);
  await p.locator('.react-flow__node').nth(1).locator('.node-generate-btn').click();
  await waitTerminal();
  let s = await sbState();
  check(s.derived === 6, `首轮应出 6 格，实际 ${s.derived}`);
  const callsAfterFirst = s.calls;

  // ── 1. 截断路径：首格失败的全新一批 → 0 产出 → 旧 6 格仍在 ──
  await p.evaluate(() => { window.__failCall = window.__genCalls.length + 1; });
  await p.locator('.react-flow__node').nth(1).locator('.node-generate-btn').click(); // 拆分（confirm 桩放行）
  await waitTerminal();
  s = await sbState();
  check(s.derived === 6, `0 产出失败后旧 6 格应原样保留，实际 ${s.derived}`);
  check((await p.locator('.node-status.failed').count()) === 1, '应处于失败态');

  // 缩格到 2x2，点失败卡重发 → truncate：保留前 4、不发请求、不建任务
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const sb = Object.values(g.useGraphStore.getState().nodes).find((n) => n.defKind === 'storyboard');
    g.setNodeParam(sb.id, 'grid', '2x2');
    window.__failCall = null;
  });
  await p.waitForTimeout(200);
  const tasksBefore = s.tasks;
  await p.locator('.node-status.failed .link-btn').first().click();
  await p.waitForTimeout(600);
  s = await sbState();
  check(s.derived === 4, `缩格重发应截断到 4 格，实际 ${s.derived}`);
  check(s.calls === callsAfterFirst + 1, `截断不应新增上游调用（仅失败那次），实际 ${s.calls}`);
  check(s.tasks === tasksBefore, `截断不应新建任务，实际 ${s.tasks}`);
  check((await p.locator('.grid-cell').count()) === 4, 'UI 应只渲染 4 格');
  const toastText = await p.locator('.chip.toast').innerText().catch(() => '');
  check(toastText.includes('资产库'), `截断应 toast 提示多余产物保留在资产库，实际「${toastText}」`);

  // ── 2. 漂移拒绝：改 grid+比例后补格 → 拒绝、无新任务 ──
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    const sb = Object.values(g.useGraphStore.getState().nodes).find((n) => n.defKind === 'storyboard');
    // 制造一个 canceled 态（有 4 格 < 9 格，canResume 成立）
    t.useTaskStore.setState({ tasks: {} });
    const id = t.submitTask({
      kind: 'image',
      params: { kind: 'image', prompt: 'x', model: 'demo/image', providerId: 'demo', inputAssetIds: [], aspectRatio: '1:1', extras: { grid: '2x2', style: '' } },
      nodeId: sb.id,
    });
    t.markRunning(id);
    t.markCanceled(id, []);
    g.setNodeParam(sb.id, 'grid', '3x3');
    g.setNodeParam(sb.id, 'aspectRatio', '9:16');
  });
  await p.waitForTimeout(300);
  const resumeBtn = p.locator('.node-status.canceled .link-btn');
  check((await resumeBtn.count()) === 1, 'canceled 态应有「继续补齐」按钮');
  check((await resumeBtn.innerText()).includes('继续补齐'), '按钮文案应是继续补齐');
  const tasksBeforeReject = (await sbState()).tasks;
  await resumeBtn.click();
  await p.waitForTimeout(400);
  const alertText = await p.locator('.conn-error[role="alert"]').innerText().catch(() => '');
  check(alertText.includes('参数已变'), `漂移补格应被拒绝并提示参数已变，实际「${alertText}」`);
  check((await sbState()).tasks === tasksBeforeReject, '拒绝不应新建任务');

  // ── 3. 刷新后截断结果持久 ──
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const sb = Object.values(g.useGraphStore.getState().nodes).find((n) => n.defKind === 'storyboard');
    g.setNodeParam(sb.id, 'grid', '2x2'); // 改回与产物一致，避免恢复后渲染歧义
  });
  await p.waitForTimeout(1200); // 等防抖保存
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const restored = await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const sb = Object.values(g.useGraphStore.getState().nodes).find((n) => n.defKind === 'storyboard');
    return sb?.derivedAssetIds?.length ?? 0;
  });
  check(restored === 4, `刷新后应仍是截断后的 4 格，实际 ${restored}`);

  finish('分镜补格计划', errs);
  await b.close();
}
