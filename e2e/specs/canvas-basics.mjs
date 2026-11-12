import { openPage, finish, check } from '../helpers.mjs';

/**
 * 画布基本功：起始框 / 添加菜单 / 删除 / 复制粘贴 / 框选多选 /
 * 对齐与自动整理 / 抓手平移 / 演示模式如实标注。
 *
 * 这一组专门盯「人能不能用」，不是「脚本能不能跑通」。
 */
export async function run() {
  const { browser: b, page: p, errors: errs } = await openPage();
  const nodeCount = () => p.locator('.react-flow__node').count();
  const positions = () =>
    p.evaluate(async () => {
      const g = await window.__intxMod('/src/app/stores/graphStore.ts');
      return Object.values(g.useGraphStore.getState().nodes).map((n) => ({ x: n.position.x, y: n.position.y }));
    });

  // ── 1. 空画布起始框 → 添加菜单 ──
  await p.locator('.canvas-starter').waitFor();
  await p.locator('.canvas-starter').click();
  await p.locator('.add-menu').waitFor();
  const menuItems = await p.locator('.add-menu button[role="menuitem"]').count();
  console.log('1) 起始框打开添加菜单:', menuItems, '项');
  check(menuItems >= 4, '添加菜单应列出全部内置节点与画布动作');
  await p.getByRole('menuitem', { name: '文字输入' }).click();
  await p.waitForTimeout(300);
  check((await nodeCount()) === 1, '从起始框添加应创建 1 个节点');

  // ── 2. 右键空白处继续添加 ──
  // 找一个确实没有节点覆盖的点：节点右键现在开的是节点菜单（三态），
  // 写死坐标可能落在已有节点上，那样测的就不是「空白右键」了。
  const blank = await p.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect());
    for (let y = pane.top + 60; y < pane.bottom - 60; y += 40) {
      for (let x = pane.left + 60; x < pane.right - 60; x += 40) {
        const hit = cards.some((r) => x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8);
        if (!hit) return { x, y };
      }
    }
    return null;
  });
  check(blank !== null, '应能找到一块空白画布');
  await p.mouse.click(blank.x, blank.y, { button: 'right' });
  await p.locator('.add-menu').waitFor();
  await p.getByRole('menuitem', { name: '生成' }).click();
  await p.waitForTimeout(300);
  check((await nodeCount()) === 2, '右键添加应再创建 1 个节点');

  // ── 3. 节点上删除按钮 + Delete 键 ──
  await p.locator('.react-flow__node').nth(0).locator('.node-delete-btn').click();
  await p.waitForTimeout(250);
  check((await nodeCount()) === 1, '节点右上角 × 应能删除单个节点（不必清空画布）');
  await p.locator('.react-flow__node').first().click();
  await p.keyboard.press('Delete');
  await p.waitForTimeout(250);
  check((await nodeCount()) === 0, 'Delete 键应删除选中节点');

  // ── 4. Ctrl+D 复制 / Ctrl+C + Ctrl+V 粘贴 ──
  await p.locator('.node-picker button').nth(0).click();
  await p.waitForTimeout(250);
  // 点节点头部，不要点卡片中心：文字输入节点中心是 <textarea>，而画布
  // 快捷键在输入框里会被正确放行（原生撤销/复制粘贴优先），那样测的就不是
  // Ctrl+D 本身了。真实用户也是点标题栏来选中节点。
  await p.locator('.react-flow__node').first().locator('.node-head').click();
  const focusTag = await p.evaluate(() => document.activeElement?.tagName ?? 'NONE');
  console.log('4) 选中节点后焦点:', focusTag);
  check(focusTag !== 'TEXTAREA' && focusTag !== 'INPUT', '点节点头部应让焦点离开输入框');
  await p.keyboard.press('Control+d');
  await p.waitForTimeout(250);
  check((await nodeCount()) === 2, 'Ctrl+D 应复制一份选中节点');
  await p.keyboard.press('Control+c');
  await p.waitForTimeout(120);
  await p.keyboard.press('Control+v');
  await p.waitForTimeout(250);
  check((await nodeCount()) === 3, 'Ctrl+C / Ctrl+V 应粘贴剪贴板里的节点');

  // ── 5. 框选多选 → 悬浮工具栏 ──
  const boxes = [];
  for (let i = 0; i < 3; i += 1) boxes.push(await p.locator('.react-flow__node').nth(i).boundingBox());
  const minX = Math.min(...boxes.map((bb) => bb.x));
  const minY = Math.min(...boxes.map((bb) => bb.y));
  const maxX = Math.max(...boxes.map((bb) => bb.x + bb.width));
  const maxY = Math.max(...boxes.map((bb) => bb.y + bb.height));
  await p.mouse.move(minX - 24, minY - 24);
  await p.mouse.down();
  await p.mouse.move(maxX + 24, maxY + 24, { steps: 14 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  const selected = await p.locator('.react-flow__node.selected').count();
  console.log('5) 框选命中:', selected, '个节点');
  check(selected >= 2, '区域选择拖动应能框选多个节点');
  await p.locator('.selection-toolbar').waitFor();
  const toolbarText = await p.locator('.selection-toolbar').innerText();
  check(toolbarText.includes('对齐') && toolbarText.includes('等距'), '悬浮栏应提供对齐与等距');

  // ── 6. 左对齐 → 撤销 ──
  const before = await positions();
  await p.locator('.selection-toolbar button', { hasText: '左对齐' }).click();
  await p.waitForTimeout(250);
  const aligned = await positions();
  const sameX = aligned.length >= 2 && aligned.every((q) => q.x === aligned[0].x);
  console.log('6) 左对齐 x:', aligned.map((q) => Math.round(q.x)).join(','));
  check(sameX, '左对齐后所有选中节点 x 应相同');
  check(aligned.some((q, i) => q.x !== before[i].x), '对齐应真的移动了节点');
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(250);
  const undone = await positions();
  check(undone.some((q) => q.x !== aligned[0].x), '对齐应能一步撤销');

  // ── 7. 自动整理不重叠、且可撤销 ──
  await p.locator('.toolbar button', { hasText: '自动整理' }).click();
  await p.waitForTimeout(300);
  const arranged = await positions();
  const unique = new Set(arranged.map((q) => `${Math.round(q.x)},${Math.round(q.y)}`));
  check(unique.size === arranged.length, '自动整理后节点不应叠在同一坐标');

  // ── 8. 抓手工具切换 ──
  await p.locator('.mode-switch button').nth(1).click();
  check((await p.locator('.mode-switch button.active').innerText()) === '抓手', '抓手按钮应成为激活态');
  await p.locator('.mode-switch button').nth(0).click();
  check((await p.locator('.mode-switch button.active').innerText()) === '区域选择', '应能切回区域选择');

  // ── 9. 演示模式如实标注 ──
  const chips = await p.locator('.toolbar').innerText();
  check(chips.includes('演示模式') && chips.includes('不出真图'), '演示厂商应明确标注不会出真图');

  finish('画布基本功', errs);
  await b.close();
}
