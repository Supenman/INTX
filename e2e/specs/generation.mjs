import { readFileSync } from 'node:fs';
import { openPage, finish, check, OUTPUT_DIR } from '../helpers.mjs';

/** 普通生成 + 分镜逐格 + 刷新恢复：验证产物真的落盘并还原。 */
export async function run() {
  const { browser: b, context: ctx, page: p, errors: errs } = await openPage();
  const cdp = await ctx.newCDPSession(p);

  // React Flow 的节点按钮偶尔会吃掉合成点击，直接用 CDP 派发原始鼠标事件更稳。
  async function realClick(locator) {
    const bb = await locator.boundingBox();
    const x = bb.x + bb.width / 2;
    const y = bb.y + bb.height / 2;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
  async function drag(from, to) {
    await p.mouse.move(from.x, from.y);
    await p.mouse.down();
    await p.mouse.move(from.x + 40, from.y + 30, { steps: 4 });
    await p.mouse.move(to.x, to.y, { steps: 16 });
    await p.waitForTimeout(120);
    await p.mouse.up();
    await p.waitForTimeout(400);
  }
  const center = (bb) => ({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });

  // ── 1. 普通生成：文字输入 → 生成 ──
  await p.locator('.node-picker button').nth(0).click();
  await p.waitForTimeout(250);
  await p.locator('.node-picker button').nth(2).click();
  await p.waitForTimeout(900);
  let nodes = p.locator('.react-flow__node');
  await nodes.nth(0).locator('textarea').fill('凌晨四点的便利店，橘猫趴在关东煮旁边打盹');
  await p.waitForTimeout(300);
  await drag(
    center(await nodes.nth(0).locator('.react-flow__handle.source').first().boundingBox()),
    center(await nodes.nth(1).locator('.react-flow__handle.target').first().boundingBox()),
  );
  const edges1 = await p.locator('.react-flow__edge').count();
  console.log('普通生成 · 连线:', edges1);
  check(edges1 === 1, '文字输入应连到生成节点');

  await realClick(nodes.nth(1).locator('.node-generate-btn'));
  await p.waitForTimeout(700);
  console.log('  生成中:', (await nodes.nth(1).locator('.node-status').innerText().catch(() => '(无)')).replace(/\n/g, ' '));
  await p.waitForTimeout(3600);
  console.log('  完成:', (await nodes.nth(1).locator('.node-status').innerText().catch(() => '(无)')).replace(/\n/g, ' '));
  const images = await nodes.nth(1).locator('.node-result img').count();
  console.log('  节点内出图:', images);
  check(images === 1, '生成节点应显示 1 张产物');
  await p.screenshot({ path: OUTPUT_DIR + 'generate.png' });

  // ── 2. 分镜：文字输入 → 分镜宫格 ──
  await p.locator('.node-picker button').nth(0).click();
  await p.waitForTimeout(250);
  await p.locator('.node-picker button').nth(3).click();
  await p.waitForTimeout(900);
  nodes = p.locator('.react-flow__node');
  await nodes.nth(2).locator('textarea').fill(
    ['雨夜天台，少女背对镜头望向城市', '她转身，眼里映着霓虹', '一只黑猫跳上栏杆', '远处警灯闪了一下'].join('\n'),
  );
  await p.waitForTimeout(300);
  const sbBox = await nodes.nth(3).boundingBox();
  await drag(
    center(await nodes.nth(2).locator('.react-flow__handle.source').first().boundingBox()),
    center(await nodes.nth(3).locator('.react-flow__handle.target').first().boundingBox()),
  );
  console.log('分镜 · 连线总数:', await p.locator('.react-flow__edge').count());

  await realClick(nodes.nth(3).locator('.node-generate-btn'));
  await p.waitForTimeout(2600);
  console.log('  中途进度:', (await nodes.nth(3).locator('.node-status').innerText().catch(() => '(无)')).replace(/\n/g, ' '));
  await p.screenshot({ path: OUTPUT_DIR + 'storyboard-running.png' });
  await p.waitForTimeout(11000);
  console.log('  完成:', (await nodes.nth(3).locator('.node-status').innerText().catch(() => '(无)')).replace(/\n/g, ' '));
  const cells = await nodes.nth(3).locator('.grid-cell').count();
  console.log('  分格数:', cells);
  check(cells === 4, '2x2 分镜应产出 4 格');

  await p.mouse.move(sbBox.x + sbBox.width / 2, sbBox.y + sbBox.height / 2);
  await p.mouse.wheel(0, 220);
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUTPUT_DIR + 'storyboard.png' });

  // ── 2.5 分镜导出：拼成一张 PNG + 单格另存 ──
  const PNG_MAGIC = '89504e470d0a1a0a';
  const gridDl = p.waitForEvent('download');
  await nodes.nth(3).locator('.node-secondary-btn').click();
  const gridFile = await gridDl;
  const gridPath = OUTPUT_DIR + 'storyboard-grid.png';
  await gridFile.saveAs(gridPath);
  const png = readFileSync(gridPath);
  const magic = png.subarray(0, 8).toString('hex');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  console.log(`2.5) 导出拼图: ${gridFile.suggestedFilename()} ${png.length} 字节 ${width}x${height} magic=${magic}`);
  check(magic === PNG_MAGIC, '导出拼图应是有效 PNG');
  check(width > 100 && height > 100, '拼图尺寸应正常');
  check(gridFile.suggestedFilename().includes('2x2'), '文件名应包含宫格规格');

  await nodes.nth(3).locator('.grid-cell').first().hover();
  const cellDl = p.waitForEvent('download');
  await nodes.nth(3).locator('.grid-cell-save').first().click();
  const cellFile = await cellDl;
  const cellPath = OUTPUT_DIR + 'storyboard-cell.png';
  await cellFile.saveAs(cellPath);
  const cellPng = readFileSync(cellPath);
  console.log(`   另存单格: ${cellFile.suggestedFilename()} ${cellPng.length} 字节`);
  check(cellPng.subarray(0, 8).toString('hex') === PNG_MAGIC && cellPng.length > 100, '单格应是有效 PNG');

  // ── 3. 刷新恢复 ──
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
  const reNodes = await p.locator('.react-flow__node').count();
  const reImages = await p.locator('.node-result img').count();
  const reCells = await p.locator('.grid-cell').count();
  const reAssets = await p.locator('.asset-thumb').count();
  console.log(`刷新后 · 节点 ${reNodes} / 出图 ${reImages} / 分格 ${reCells} / 资产库 ${reAssets}`);
  check(reNodes === 4 && reImages === 1 && reCells === 4, '刷新后画布与产物应完整还原');
  check(reAssets > 0, '刷新后资产库应有产物');
  await p.screenshot({ path: OUTPUT_DIR + 'reload.png' });

  finish('生成闭环', errs);
  await b.close();
}
