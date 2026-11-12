import { openPage, finish, check } from '../helpers.mjs';

/**
 * 面板统一交互：所有浮层共用 PanelMask 之后，锁住三条规则——
 *
 * 1. Esc 能关（此前设置/审计/旧版导入完全不响应 Esc）。
 * 2. 遮罩关闭要「按下在遮罩 && 抬起也在遮罩」：从面板内部按下、
 *    拖到遮罩上松手不能误关（旧 onClick 实现会）。
 * 3. 输入框里的 Esc 让位给字段语义：批量改名输入框 Esc 放弃编辑，
 *    而不是被全局监听抢走。
 *
 * 顺带锁节点状态行的语义类（running/succeeded/queued），
 * 防止将来有人把颜色又写回 inline style。
 */
export async function run() {
  const { browser: b, page: p, errors: errs } = await openPage();

  const mask = () => p.locator('.panel-mask');
  const settingsBtn = p.locator('.sidebar .icon-btn').first();

  // ── 1. 设置面板：Esc 关闭 ──
  await settingsBtn.click();
  await p.locator('.panel h2', { hasText: '厂商设置' }).waitFor();
  check((await mask().count()) === 1, '设置面板应打开');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  check((await mask().count()) === 0, 'Esc 应关闭设置面板');

  // ── 2. 设置面板：面板内按下→遮罩松手，不误关 ──
  await settingsBtn.click();
  await p.locator('.panel h2', { hasText: '厂商设置' }).waitFor();
  const panelBox = await p.locator('.panel').boundingBox();
  await p.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + 30);
  await p.mouse.down();
  await p.mouse.move(20, 20, { steps: 6 }); // 拖到遮罩上
  await p.mouse.up();
  await p.waitForTimeout(200);
  check((await mask().count()) === 1, '面板内按下、遮罩松手不应误关面板');

  // ── 3. 真遮罩点击（按下+抬起都在遮罩）应关闭 ──
  await p.mouse.move(20, 20);
  await p.mouse.down();
  await p.mouse.up();
  await p.waitForTimeout(200);
  check((await mask().count()) === 0, '遮罩上完整的点击应关闭面板');

  // ── 4. 审计面板：Esc 关闭 ──
  await p.locator('.sidebar button', { hasText: '审计台账' }).click();
  await p.locator('.panel h2', { hasText: '审计台账' }).waitFor();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  check((await mask().count()) === 0, 'Esc 应关闭审计面板');

  // ── 5. 旧版导入：Esc 关闭 ──
  await p.locator('.sidebar button', { hasText: '导入旧版数据' }).click();
  await p.locator('.panel h2', { hasText: '导入旧版' }).waitFor();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  check((await mask().count()) === 0, 'Esc 应关闭旧版导入对话框');

  // ── 6. 批量改名：输入框内 Esc 放弃编辑（字段语义优先） ──
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    g.resetGraph();
    g.addNode({ defKind: 'generate', position: { x: 120, y: 120 } });
    g.addNode({ defKind: 'generate', position: { x: 460, y: 120 } });
  });
  await p.waitForTimeout(300);
  // 框选两个节点后从选区工具栏开批量改名
  await p.keyboard.press('Control+a').catch(() => {});
  const opened = await p.evaluate(async () => {
    // 直接走注册表动作入口，避免依赖框选手势的坐标稳定性
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    return Object.keys(g.useGraphStore.getState().nodes).length;
  });
  check(opened === 2, '应有两个节点');
  // 用选区工具栏按钮（先选中）
  await p.locator('.react-flow__node').first().click();
  await p.keyboard.down('Shift');
  await p.locator('.react-flow__node').nth(1).click();
  await p.keyboard.up('Shift');
  await p.waitForTimeout(250);
  const renameBtn = p.locator('[data-tool-id="rename-selection"]');
  if ((await renameBtn.count()) > 0) {
    await renameBtn.first().click();
    await p.locator('.batch-rename-input').waitFor();
    await p.locator('.batch-rename-input').fill('测试 #');
    await p.locator('.batch-rename-input').press('Escape');
    await p.waitForTimeout(200);
    check((await mask().count()) === 0, '输入框内 Esc 应放弃批量改名');
    const titles = await p.evaluate(async () => {
      const g = await window.__intxMod('/src/app/stores/graphStore.ts');
      return Object.values(g.useGraphStore.getState().nodes).map((n) => n.title ?? '');
    });
    check(titles.every((t) => !t.startsWith('测试')), 'Esc 放弃后不应写入改名');
  }

  // ── 7. 节点状态行语义类：颜色在 CSS，不在 inline style ──
  const statusInfo = await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    const nodeId = Object.keys(g.useGraphStore.getState().nodes)[0];
    t.useTaskStore.setState({ tasks: {} });
    const id = t.submitTask({
      kind: 'image',
      params: { kind: 'image', prompt: 'x', model: 'demo/image', providerId: 'demo', inputAssetIds: [], aspectRatio: '1:1' },
      nodeId,
    });
    t.markRunning(id);
    return nodeId;
  });
  await p.waitForTimeout(250);
  const running = p.locator('.node-status.running').first();
  check((await running.count()) === 1, 'running 状态行应有语义类');
  const inlineColor = await running.locator('.phase').evaluate((el) => el.style.color);
  check(inlineColor === '', 'phase 颜色不应写 inline style');
  await p.evaluate(async () => {
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    const id = Object.keys(t.useTaskStore.getState().tasks)[0];
    t.markSucceeded(id, []);
  });
  await p.waitForTimeout(250);
  check((await p.locator('.node-status.succeeded').count()) === 1, 'succeeded 状态行应有语义类');

  finish('面板统一交互', errs);
  await b.close();
}
