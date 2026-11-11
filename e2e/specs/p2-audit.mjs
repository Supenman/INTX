import { openPage, finish, check } from '../helpers.mjs';

/**
 * P2：审计台账 / 数据出境 / 成本归因 / 一键复现。
 *
 * 单测证明了纯函数算得对，但证明不了这些只有浏览器才知道的事：
 * 审计面板真的能打开、表格真的渲染、出境标记真的跟着厂商 scope 变、
 * 导出复现包真的能拿到文件、导入时原厂商不在会被人话拒绝（而不是静默用别家）。
 *
 * 这一组的重点是第 4 条：它验证的正是复核时抓到的那个「跑得太通」的缺陷。
 */
export async function run() {
  const { page: p, errors: errs } = await openPage();
  const auditBtn = () => p.locator('.sidebar button', { hasText: '审计台账' });

  // ── 1. 造一条真任务：文字节点 → 生成节点 → 跑演示厂商 ────────────
  await p.locator('.sidebar .node-picker button', { hasText: '文字输入' }).click();
  await p.waitForTimeout(300);
  await p.locator('.sidebar .node-picker button', { hasText: '生成' }).click();
  await p.waitForTimeout(400);

  const ids = await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    return Object.keys(g.useGraphStore.getState().nodes);
  });
  check(ids.length === 2, `应有两个节点，实际 ${ids.length}`);

  // 写入提示词、连线、生成
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const nodes = Object.values(g.useGraphStore.getState().nodes);
    const text = nodes.find((n) => n.defKind === 'text-input');
    const gen = nodes.find((n) => n.defKind === 'generate');
    g.setNodeParam(text.id, 'content', '雨夜霓虹街口，积水反光，无人物');
    g.connectNodes({
      sourceNodeId: text.id,
      sourcePortId: 'text',
      targetNodeId: gen.id,
      targetPortId: 'prompt',
    });
  });
  await p.waitForTimeout(300);

  // 点生成，等任务成功
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const gen = Object.values(g.useGraphStore.getState().nodes).find((n) => n.defKind === 'generate');
    // 必须点名 .node-generate-btn：卡片上第一个 button 是删除按钮，选错就什么也不会发生
    const el = document.querySelector(`[data-id="${gen.id}"] .node-generate-btn:not(.danger-btn)`);
    if (!el) throw new Error('找不到生成按钮');
    el.click();
  });

  let taskOk = false;
  for (let i = 0; i < 40; i += 1) {
    await p.waitForTimeout(500);
    const st = await p.evaluate(async () => {
      const t = await window.__intxMod('/src/app/stores/taskStore.ts');
      const tasks = Object.values(t.useTaskStore.getState().tasks);
      return tasks.map((x) => ({ status: x.status, cost: x.cost, resultCount: x.resultAssetIds.length }));
    });
    if (st.length > 0 && st.every((x) => x.status === 'succeeded' || x.status === 'failed')) {
      taskOk = st.some((x) => x.status === 'succeeded');
      check(taskOk, `任务应成功，实际 ${JSON.stringify(st)}`);
      check(
        st.some((x) => x.cost && x.cost.amount > 0),
        `演示厂商有单价，任务应带成本，实际 ${JSON.stringify(st.map((x) => x.cost))}`,
      );
      break;
    }
  }
  check(taskOk, '生成任务超时未完成');

  // ── 2. 打开审计台账，表格应有记录 ────────────────────────────────
  await auditBtn().click();
  await p.locator('.panel h2', { hasText: '审计台账' }).waitFor();
  const rows = await p.locator('.audit-table tbody tr').count();
  check(rows >= 1, `审计台账应至少 1 行，实际 ${rows}`);

  const summaryText = await p.locator('.audit-summary').innerText();
  check(summaryText.includes('总'), '汇总行应显示总数');
  check(/USD|CNY/.test(summaryText), `汇总应显示成本币种，实际「${summaryText}」`);

  // 演示厂商 scope=internal → 该行「出境」应为否
  const firstRowText = await p.locator('.audit-table tbody tr').first().innerText();
  check(firstRowText.includes('内部'), `演示厂商应标「内部」，实际行内容：${firstRowText.slice(0, 80)}`);

  // ── 3. 改厂商 scope 为 external，台账出境标记应随之变化 ──────────
  //     这条正是复核抓到的「useMemo 漏依赖」缺陷的回归断言
  await p.evaluate(async () => {
    const s = await window.__intxMod('/src/app/stores/providerStore.ts');
    const configs = s.useProviderStore.getState().configs.map((c) => ({ ...c, scope: 'external' }));
    s.useProviderStore.setState({ configs });
  });
  await p.waitForTimeout(400);
  const afterScopeText = await p.locator('.audit-table tbody tr').first().innerText();
  check(
    afterScopeText.includes('外部'),
    `厂商改为 external 后台账应立即显示「外部」，实际：${afterScopeText.slice(0, 80)}`,
  );

  // ── 4. 导出复现包：应真的拿到一个 json 文件 ──────────────────────
  const dl = p.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await p.locator('.audit-table tbody tr').first().locator('button', { hasText: '复现包' }).click();
  const download = await dl;
  check(download !== null, '点击「复现包」应触发下载');
  if (download) {
    const name = download.suggestedFilename();
    check(name.endsWith('.json') && name.includes('repro'), `下载文件名应像 intx-repro-*.json，实际 ${name}`);
  }

  // ── 5. 导入复现包：原厂商不存在时应被拒绝且说清原因 ──────────────
  const rejectMsg = await p.evaluate(async () => {
    const r = await window.__intxMod('/src/app/useCases/reproRunner.ts');
    const kept = await window.__intxMod('/src/domain/repro/model.ts');
    const pkg = kept.buildReproPackage({
      taskId: 'tk_fake',
      params: {
        kind: 'image',
        prompt: 'x',
        model: 'gpt-image-1',
        providerId: 'not-on-this-machine',
        inputAssetIds: [],
      },
    });
    const res = await r.runReproPackage(pkg);
    return res;
  });
  check(rejectMsg.ok === false, '原厂商不存在时复现必须失败，不能静默替换');
  check(
    typeof rejectMsg.message === 'string' && rejectMsg.message.includes('not-on-this-machine'),
    `拒绝信息应说清缺哪个厂商，实际：${rejectMsg.message}`,
  );

  // ── 5. 成功复现：必须重建上游文字节点并真的重跑 ─────────────────
  // 真机上踩到的坑：生成节点的 prompt 口是 required，校验只看连线、不认 params.prompt。
  // 早期只建一个孤立生成节点，被自己的校验拦住——点了没反应，连任务都不建，台账里也不留痕。
  const repro = await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    const r = await window.__intxMod('/src/app/useCases/reproRunner.ts');

    const before = {
      nodes: Object.keys(g.useGraphStore.getState().nodes).length,
      tasks: Object.keys(t.useTaskStore.getState().tasks).length,
    };

    const res = await r.runReproPackage({
      version: 1,
      exportedAt: Date.now(),
      taskId: 'e2e_repro',
      params: {
        kind: 'image',
        prompt: 'repro probe',
        model: 'demo/image',
        providerId: 'demo',
        inputAssetIds: [],
      },
      references: [],
      results: [],
    });

    for (let i = 0; i < 40; i += 1) {
      const list = Object.values(t.useTaskStore.getState().tasks);
      const done = list.every((x) => ['succeeded', 'failed', 'canceled'].includes(x.status));
      if (list.length > before.tasks && done) break;
      await new Promise((res2) => setTimeout(res2, 150));
    }

    const nodes = Object.values(g.useGraphStore.getState().nodes);
    const tasks = Object.values(t.useTaskStore.getState().tasks);
    const last = tasks[tasks.length - 1];
    return {
      ok: res.ok,
      message: res.message ?? null,
      before,
      afterNodes: nodes.length,
      kinds: nodes.map((n) => n.defKind),
      edges: Object.values(g.useGraphStore.getState().edges).map((e) => ({ sp: e.sourcePort, tp: e.targetPort })),
      taskCount: tasks.length,
      lastTask: last ? { status: last.status, hasCost: Boolean(last.cost) } : null,
    };
  });

  check(repro.ok === true, `复现应成功，实际：${repro.message}`);
  check(
    repro.afterNodes === repro.before.nodes + 2,
    `复现应新建 2 个节点（文字+生成），实际 ${repro.before.nodes}→${repro.afterNodes}`,
  );
  check(repro.kinds.includes('text-input'), '复现必须重建上游文字节点，否则 prompt 口必填校验会拦住重跑');
  check(
    repro.edges.some((e) => e.sp === 'text' && e.tp === 'prompt'),
    '文字节点必须连到生成节点的 prompt 口',
  );
  check(repro.taskCount > repro.before.tasks, '复现必须真的创建任务（执行链路要跑到）');
  check(repro.lastTask?.status === 'succeeded', `复现任务应成功，实际 ${repro.lastTask?.status}`);
  check(repro.lastTask?.hasCost === true, '复现任务应带成本记录');

  await p.screenshot({ path: `${process.env.INTX_OUT ?? 'e2e/output'}/p2-audit.png` });
  await finish('P2 审计/出境/成本/复现', errs);
}
