import { openPage, finish, check } from '../helpers.mjs';

/**
 * 节点改名（单个 + 批量）。
 *
 * 这一组只测「非点不可才发现」的事：
 *  - 改名是不是真的落到了节点上（而不是只改了输入框的 state）
 *  - Esc 是不是真的放弃（旧实现里 Escape 会漏到画布上，把节点一起删了）
 *  - 批量改名的编号顺序是不是按画布坐标（按点击顺序会是另一个结果，而且
 *    错位之后很难发现——十张图里 03 和 04 反了没人看得出来）
 *  - 刷新之后名字还在（内存里改对、没进存档，是这套项目里出现过的问题）
 */
export async function run() {
  const { browser: b, page: p, errors: errs } = await openPage();
  const nodes = () => p.locator('.react-flow__node');
  const headTitle = (i) => p.locator('.node-title').nth(i);
  const titleInput = () => p.locator('.node-title-input');

  // ── 1. 两个生成节点 ──
  await p.locator('.node-picker button', { hasText: '生成' }).first().click();
  await p.waitForTimeout(400);
  await p.locator('.node-picker button', { hasText: '生成' }).nth(0).click();
  await p.waitForTimeout(400);
  check((await nodes().count()) === 2, `应有 2 个节点（得到 ${await nodes().count()}）`);

  // ── 2. 单击标题改名，Enter 生效 ──
  await headTitle(0).click();
  await titleInput().waitFor();
  // 聚焦即全选：直接输入应该把旧名整个替换掉，而不是拼在后面
  await p.keyboard.type('雨夜街景');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(250);
  check((await titleInput().count()) === 0, 'Enter 后输入框应收起');
  check((await headTitle(0).innerText()) === '雨夜街景', `卡片应显示新名字（得到「${await headTitle(0).innerText()}」）`);

  // ── 3. Esc 放弃，名字不变 ──
  await headTitle(0).click();
  await titleInput().waitFor();
  await p.keyboard.type('不该保存的名字');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  check((await headTitle(0).innerText()) === '雨夜街景', 'Esc 应放弃这次改名');
  check((await nodes().count()) === 2, 'Esc 不能漏到画布上把节点删掉');

  // ── 4. 清空名字回退到类型名 ──
  await headTitle(0).click();
  await p.keyboard.press('Control+a');
  await p.keyboard.press('Delete');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(250);
  check((await headTitle(0).innerText()) === '生成', `清空应回退到类型名（得到「${await headTitle(0).innerText()}」）`);

  // ── 5. 框选两个 → 批量改名 ──
  const boxes = [];
  for (let i = 0; i < 2; i += 1) boxes.push(await nodes().nth(i).boundingBox());
  const minX = Math.min(...boxes.map((bb) => bb.x));
  const minY = Math.min(...boxes.map((bb) => bb.y));
  const maxX = Math.max(...boxes.map((bb) => bb.x + bb.width));
  const maxY = Math.max(...boxes.map((bb) => bb.y + bb.height));
  await p.mouse.move(minX - 26, minY - 26);
  await p.mouse.down();
  await p.mouse.move(maxX + 26, maxY + 26, { steps: 14 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  check((await p.locator('.react-flow__node.selected').count()) === 2, '应框选中 2 个节点');

  await p.locator('.selection-toolbar button', { hasText: '批量改名' }).click();
  const dialog = p.locator('.batch-rename');
  await dialog.waitFor();

  const patternInput = p.locator('.batch-rename-input');
  await patternInput.fill('主图 #');
  await p.waitForTimeout(200);
  const preview = await p.locator('.batch-rename-chip').allInnerTexts();
  check(preview.length >= 2, '预览应至少显示两条');
  check(preview[0] === '主图 01', `预览第一条应是「主图 01」（得到「${preview[0]}」）`);

  await p.locator('.batch-rename button', { hasText: '重命名' }).click();
  await p.waitForTimeout(350);
  check((await dialog.count()) === 0, '确定后浮层应关闭');

  const names = await p.locator('.react-flow__node .node-title').allInnerTexts();
  // 按画布坐标：默认新节点是往右下方排的，所以第一个是 01
  check(names.includes('主图 01') && names.includes('主图 02'), `两个节点都应带编号（得到 ${JSON.stringify(names)}）`);
  check(names.indexOf('主图 01') < names.indexOf('主图 02'), '01 必须排在 02 前面');

  // ── 6. 刷新后名字还在 ──
  await p.waitForTimeout(900);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const afterReload = await p.locator('.react-flow__node .node-title').allInnerTexts();
  check(
    afterReload.includes('主图 01') && afterReload.includes('主图 02'),
    `刷新后名字应还在（得到 ${JSON.stringify(afterReload)}）`,
  );

  finish('节点改名', errs);
  await b.close();
}
