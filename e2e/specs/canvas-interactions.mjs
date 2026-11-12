import { openPage, finish, check } from '../helpers.mjs';

/**
 * 画布交互升级：右键三态 / 拖入 / 快捷键面板 / 视图控制。
 *
 * 右键菜单的「单节点 vs 多选」分流在 domain 注册表里（applicable + countLabel），
 * 这里锁的是浏览器里的真实后果：菜单条目对不对、数量标签对不对、点了真生效。
 * 拖入用 DataTransfer 合成事件（Playwright 的 mouse 拖拽不携带自定义 MIME）。
 */
export async function run() {
  const { browser: b, page: p, errors: errs } = await openPage();
  const nodes = () => p.locator('.react-flow__node');

  // ── 0. 准备两个节点 ──
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    g.resetGraph();
    g.addNode({ defKind: 'generate', position: { x: 120, y: 120 } });
    g.addNode({ defKind: 'text-input', position: { x: 560, y: 120 } });
  });
  await p.waitForTimeout(400);
  check((await nodes().count()) === 2, '应有两个节点');

  // ── 1. 单节点右键：出现节点菜单（不是添加菜单），含复制/删除 ──
  await nodes().first().click({ button: 'right' });
  await p.locator('.node-context-menu').waitFor();
  check((await p.locator('.add-menu:not(.node-context-menu)').count()) === 0, '单节点右键不应开添加菜单');
  const singleLabels = await p.locator('.node-context-menu button[role="menuitem"]').allInnerTexts();
  check(singleLabels.some((t) => t.includes('复制节点')), '单节点菜单应有「复制节点」');
  check(singleLabels.some((t) => t.includes('删除节点')), '单节点菜单应有「删除节点」');
  check(!singleLabels.some((t) => /\d+ 个节点/.test(t)), '单节点菜单不应带数量标签');
  // 生成节点应有「生成」
  check(singleLabels.some((t) => t.trim() === '生成'), '生成节点右键应有「生成」');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);

  // ── 2. 单节点菜单「复制节点」真生效 ──
  await nodes().first().click({ button: 'right' });
  await p.locator('.node-context-menu').waitFor();
  await p.locator('.node-context-menu button', { hasText: '复制节点' }).click();
  await p.waitForTimeout(300);
  check((await nodes().count()) === 3, '点「复制节点」应复制出 1 个');

  // ── 3. 多选右键：数量标签 + 批量动作 ──
  // 用框选建立多选（与真实用户一致）。
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    g.resetGraph();
    g.addNode({ defKind: 'generate', position: { x: 120, y: 120 } });
    g.addNode({ defKind: 'generate', position: { x: 560, y: 120 } });
    g.addNode({ defKind: 'text-input', position: { x: 1000, y: 120 } });
  });
  await p.waitForTimeout(400);
  const boxes = [];
  for (let i = 0; i < 3; i += 1) boxes.push(await nodes().nth(i).boundingBox());
  const minX = Math.min(...boxes.map((bb) => bb.x));
  const minY = Math.min(...boxes.map((bb) => bb.y));
  const maxX = Math.max(...boxes.map((bb) => bb.x + bb.width));
  const maxY = Math.max(...boxes.map((bb) => bb.y + bb.height));
  await p.mouse.move(minX - 24, minY - 24);
  await p.mouse.down();
  await p.mouse.move(maxX + 24, maxY + 24, { steps: 14 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  const selectedCount = await p.locator('.react-flow__node.selected').count();
  check(selectedCount === 3, `框选应选中 3 个节点，实际 ${selectedCount}`);
  // 右键已选中的节点：保留多选，菜单走多选态。
  // 框选后 React Flow 盖一层 nodesselection-rect 拦截真实指针，
  // 直接在节点元素上派发 contextmenu（React 合成事件走 root 委托，能触发 onNodeContextMenu）。
  await p.evaluate(() => {
    const nodeEl = document.querySelectorAll('.react-flow__node')[1];
    const r = nodeEl.getBoundingClientRect();
    nodeEl.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + 12, button: 2,
    }));
  });
  await p.locator('.node-context-menu').waitFor();
  const multiLabels = await p.locator('.node-context-menu button[role="menuitem"]').allInnerTexts();
  check(multiLabels.some((t) => t.includes('复制 3 个节点')), `多选菜单应带数量「复制 3 个节点」，实际 ${JSON.stringify(multiLabels)}`);
  check(multiLabels.some((t) => t.includes('删除 3 个节点')), '多选菜单应带数量「删除 3 个节点」');
  check(multiLabels.some((t) => t.includes('批量改名')), '多选菜单应有「批量改名」');
  check(!multiLabels.some((t) => t.trim() === '生成'), '多选菜单不应出现单节点的「生成」');
  // 点「删除 3 个节点」真生效
  await p.locator('.node-context-menu button', { hasText: '删除 3 个节点' }).click();
  await p.waitForTimeout(300);
  check((await nodes().count()) === 0, '点「删除 3 个节点」应删掉全部选中');

  // ── 4. 空白右键仍是添加菜单 ──
  // 删除后选区框可能还盖在画布上拦截指针，先点一下空白清掉，再右键。
  const pane = await p.locator('.react-flow__pane').boundingBox();
  await p.mouse.click(pane.x + 700, pane.y + 500);
  await p.waitForTimeout(200);
  await p.mouse.click(pane.x + 700, pane.y + 500, { button: 'right' });
  await p.locator('.add-menu').waitFor();
  check((await p.locator('.node-context-menu').count()) === 0, '空白右键应是添加菜单');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);

  // ── 5. 快捷键面板：? 打开，Esc 关闭 ──
  await p.keyboard.press('?');
  await p.locator('.shortcuts-panel').waitFor();
  check((await p.locator('.shortcut-row').count()) >= 10, '快捷键面板应列出足够条目');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  check((await p.locator('.shortcuts-panel').count()) === 0, 'Esc 应关闭快捷键面板');

  // ── 6. 视图控制：Ctrl+2 适应全部后 zoom 变化 ──
  await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    g.resetGraph();
    g.addNode({ defKind: 'generate', position: { x: 0, y: 0 } });
    g.addNode({ defKind: 'generate', position: { x: 2000, y: 1500 } });
  });
  await p.waitForTimeout(400);
  const zoomBefore = await p.evaluate(() => document.querySelector('.react-flow__viewport')?.style.transform ?? '');
  await p.keyboard.press('Control+2');
  await p.waitForTimeout(500);
  const zoomAfter = await p.evaluate(() => document.querySelector('.react-flow__viewport')?.style.transform ?? '');
  check(zoomBefore !== zoomAfter, 'Ctrl+2 适应全部应改变视口 transform');
  await p.keyboard.press('Control+1');
  await p.waitForTimeout(500);
  const zoom100 = await p.evaluate(() => {
    const m = document.querySelector('.react-flow__viewport')?.style.transform.match(/scale\(([\d.]+)\)/);
    return m ? parseFloat(m[1]) : null;
  });
  check(zoom100 !== null && Math.abs(zoom100 - 1) < 0.01, `Ctrl+1 应缩放到 100%，实际 ${zoom100}`);

  // ── 7. 拖入节点：合成 drop 事件落在指针处 ──
  const before7 = await nodes().count();
  await p.evaluate(async () => {
    const pane = document.querySelector('.react-flow__pane');
    const dt = new DataTransfer();
    dt.setData('application/x-intx-node', 'text-input');
    pane.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 600, clientY: 400 }));
    pane.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 600, clientY: 400 }));
  });
  await p.waitForTimeout(400);
  check((await nodes().count()) === before7 + 1, '拖入节点类型应新建一个节点');
  const dropped = await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const all = Object.values(g.useGraphStore.getState().nodes);
    return all[all.length - 1];
  });
  check(dropped.defKind === 'text-input', '拖入的应是 text-input 节点');

  // ── 8. 侧栏节点按钮带 draggable 与 MIME 标记 ──
  const dragInfo = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.node-picker button')].find((b) => b.textContent?.trim() === '生成');
    if (!btn) return null;
    const dt = new DataTransfer();
    btn.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { draggable: btn.draggable, mime: dt.getData('application/x-intx-node') };
  });
  check(dragInfo?.draggable === true, '侧栏节点按钮应可拖拽');
  check(dragInfo?.mime === 'generate', 'dragstart 应写入节点类型 MIME');

  finish('画布交互升级', errs);
  await b.close();
}
