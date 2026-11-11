import { openPage, finish, check, OUTPUT_DIR } from '../helpers.mjs';

/**
 * 工具注册表 / 工具栏偏好 / 节点悬浮栏 / 连线语义（P1）。
 *
 * 单测能证明 resolveToolbarEntries() 解析得对，但证明不了下面这些只有浏览器
 * 才知道的事：按钮真的出现在屏幕上、点了真的 dispatch 生效、偏好刷新后还在、
 * 单路输入口换源时 UI 与 store 结论一致、连线被拒时给用户的是人话而不是枚举。
 * 这一组补的正是这段「注册表 → UI → store → localStorage」的完整链路。
 *
 * 刻意不复用 canvas-basics 的断言：那一组验的是「画布能不能编辑」，
 * 这一组验的是「编辑能力是不是由注册表长出来的」。
 */
export async function run() {
  const { browser: b, page: p, errors: errs } = await openPage();
  const nodes = () => p.locator('.react-flow__node');
  const nodeCount = () => nodes().count();
  const nodeIds = () =>
    p.evaluate(async () => {
      const g = await window.__intxMod('/src/app/stores/graphStore.ts');
      return Object.keys(g.useGraphStore.getState().nodes);
    });
  const edges = () =>
    p.evaluate(async () => {
      const g = await window.__intxMod('/src/app/stores/graphStore.ts');
      return Object.values(g.useGraphStore.getState().edges).map((e) => ({
        source: e.source,
        target: e.target,
        targetPort: e.targetPort,
      }));
    });
  const center = (bb) => ({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
  const port = (i, kind) => nodes().nth(i).locator(`.react-flow__handle.${kind}`).first();
  const drag = async (fromLoc, toLoc) => {
    const from = center(await fromLoc.boundingBox());
    const to = center(await toLoc.boundingBox());
    await p.mouse.move(from.x, from.y);
    await p.mouse.down();
    await p.mouse.move(from.x + 40, from.y + 30, { steps: 4 });
    await p.mouse.move(to.x, to.y, { steps: 16 });
    await p.waitForTimeout(120);
    await p.mouse.up();
    await p.waitForTimeout(400);
  };
  const openMenuAtBlank = async () => {
    const pane = await p.locator('.react-flow__pane').boundingBox();
    await p.mouse.click(pane.x + 900, pane.y + 600, { button: 'right' });
    await p.locator('.add-menu').waitFor();
  };
  const closeMenu = async () => {
    await p.locator('.menu-backdrop').click();
    await p.waitForTimeout(180);
  };
  const boxSelect = async (count) => {
    const boxes = [];
    for (let i = 0; i < count; i += 1) boxes.push(await nodes().nth(i).boundingBox());
    const minX = Math.min(...boxes.map((bb) => bb.x));
    const minY = Math.min(...boxes.map((bb) => bb.y));
    const maxX = Math.max(...boxes.map((bb) => bb.x + bb.width));
    const maxY = Math.max(...boxes.map((bb) => bb.y + bb.height));
    await p.mouse.move(minX - 24, minY - 24);
    await p.mouse.down();
    await p.mouse.move(maxX + 24, maxY + 24, { steps: 14 });
    await p.mouse.up();
    await p.waitForTimeout(300);
  };

  // ── 1. 空态起始框 + 节点条目由注册表动态生成 ──
  await p.locator('.canvas-starter').waitFor();
  await p.locator('.canvas-starter').click();
  await p.locator('.add-menu').waitFor();
  const nodeCommands = await p.locator('.add-menu button[role="menuitem"][data-tool-id^="node:"]').count();
  console.log('1) 添加菜单里由节点注册表生成的条目:', nodeCommands);
  check(nodeCommands >= 4, '添加菜单应动态列出全部内置节点，而不是手写死几条');
  const paste = p.locator('.add-menu button[data-tool-id="menu-paste"]');
  check(await paste.isDisabled(), '剪贴板为空时「粘贴」应置灰');
  check((await paste.innerText()).includes('剪贴板为空'), '「粘贴」应说明为什么不能用，而不是静静灰掉');
  await closeMenu();

  // ── 2. 主工具栏由注册表生成：disabled → enabled → dispatch 真生效 ──
  const undo = p.locator('.toolbar button[data-tool-id="undo"]');
  check(await undo.isDisabled(), '初始没有历史，注册出来的「撤销」应是禁用态');
  await p.locator('.node-picker button').nth(0).click(); // 文字输入
  await p.waitForTimeout(250);
  check((await nodeCount()) === 1, '应创建 1 个文字输入节点');
  check(!(await undo.isDisabled()), '有了历史后「撤销」应自动可用（不需要 UI 手写 if）');
  await undo.click();
  await p.waitForTimeout(250);
  check((await nodeCount()) === 0, '点注册表按钮应真的 dispatch 到撤销');
  const redo = p.locator('.toolbar button[data-tool-id="redo"]');
  check(!(await redo.isDisabled()), '撤销后「重做」应自动可用');
  await redo.click();
  await p.waitForTimeout(250);
  check((await nodeCount()) === 1, '点「重做」应恢复节点');

  // ── 3. 单路输入口换源：UI 与 store 必须同时放行，且只留一条边 ──
  await p.locator('.node-picker button').nth(0).click(); // 第二个文字输入
  await p.locator('.node-picker button').nth(2).click(); // 生成节点
  await p.waitForTimeout(400);
  check((await nodeCount()) === 3, '应有 2 个文字输入 + 1 个生成节点');
  const ids = await nodeIds();
  await drag(port(0, 'source'), port(2, 'target'));
  const firstEdges = await edges();
  console.log('3) 第一次连线:', JSON.stringify(firstEdges));
  check(firstEdges.length === 1 && firstEdges[0].targetPort === 'prompt', '文字应连到生成的「提示词」输入口');
  await drag(port(1, 'source'), port(2, 'target'));
  const swapped = await edges();
  console.log('   换源后:', JSON.stringify(swapped));
  check(swapped.length === 1, '单路输入口换源应替换旧边，而不是叠成两条');
  check(swapped[0].source === ids[1], '换源后剩下的连线应来自第二个文字输入');
  check(swapped[0].source !== ids[0], '旧的那条边应被删掉');

  // ── 4. 连线被拒时说人话，不把 image / text 这类内部枚举丢给用户 ──
  await p.locator('.node-picker button').nth(1).click(); // 素材节点（输出 image）
  await p.waitForTimeout(300);
  await drag(port(3, 'source'), port(2, 'target'));
  const errText = await p.locator('.conn-error').innerText().catch(() => '');
  console.log('4) 连线错误提示:', errText.replace(/\n/g, ' '));
  check(errText.includes('图片') && errText.includes('文字'), '类型不匹配的提示应把 image/text 说成「图片/文字」');
  check(!/\bimage\b|\btext\b/.test(errText), '提示里不应残留 image / text 这类内部枚举');
  check((await edges()).length === 1, '被拒绝的连线不应改写已有的换源结果');

  // ── 5. 节点悬浮栏由 applicable 谓词决定，复制按钮真的生效 ──
  await nodes().nth(2).hover();
  await p.waitForTimeout(200);
  const genHover = nodes().nth(2).locator('.node-hover-toolbar');
  check(
    (await genHover.locator('button[data-tool-id="node-generate"]').count()) === 1,
    '生成节点的悬浮栏应出现「生成」按钮',
  );
  await nodes().nth(0).hover();
  await p.waitForTimeout(200);
  const textHover = nodes().nth(0).locator('.node-hover-toolbar');
  check(
    (await textHover.locator('button[data-tool-id="node-generate"]').count()) === 0,
    '文字输入节点的悬浮栏不应出现「生成」按钮（applicable 谓词生效）',
  );
  const before = await nodeCount();
  await nodes().nth(2).hover();
  await genHover.locator('button[data-tool-id="node-duplicate"]').click();
  await p.waitForTimeout(300);
  check((await nodeCount()) === before + 1, '点悬浮栏「复制」应真的复制出 1 个节点');

  // ── 6. 工具栏显隐开关写进 localStorage，刷新后仍在 ──
  await openMenuAtBlank();
  const toggle = p.locator('.add-menu-toggle input[data-tool-toggle="chain-selection"]');
  await toggle.uncheck();
  const prefsRaw = await p.evaluate(() => localStorage.getItem('intx-toolbar-prefs-selection-v1'));
  console.log('6) 偏好落盘:', prefsRaw);
  check(prefsRaw && JSON.parse(prefsRaw).hidden.includes('chain-selection'), '取消勾选应写进 localStorage 的 hidden');
  await closeMenu();
  await boxSelect(3);
  await p.locator('.selection-toolbar').waitFor();
  check(
    !(await p.locator('.selection-toolbar').innerText()).includes('批量连接'),
    '隐藏后多选悬浮栏不应再出现「批量连接」',
  );
  await p.screenshot({ path: OUTPUT_DIR + 'tool-registry.png' });

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const persisted = await p.evaluate(() => localStorage.getItem('intx-toolbar-prefs-selection-v1'));
  check(persisted && JSON.parse(persisted).hidden.includes('chain-selection'), '刷新后偏好应仍在 localStorage');
  // 项目存档可能恢复节点，也可能不恢复；补到至少 3 个再验证悬浮栏，不赌恢复时序。
  while ((await nodeCount()) < 3) {
    await p.locator('.node-picker button').nth(0).click();
    await p.waitForTimeout(220);
  }
  await openMenuAtBlank();
  check(
    !(await p.locator('.add-menu-toggle input[data-tool-toggle="chain-selection"]').isChecked()),
    '刷新后菜单里的复选框应记住上次的隐藏设置',
  );
  await closeMenu();
  await boxSelect(3);
  await p.locator('.selection-toolbar').waitFor();
  check(
    !(await p.locator('.selection-toolbar').innerText()).includes('批量连接'),
    '刷新后多选悬浮栏仍不应出现被隐藏的工具',
  );

  finish('工具注册表/偏好/悬浮栏', errs);
  await b.close();
}
