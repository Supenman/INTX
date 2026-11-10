import { readFileSync, statSync } from 'node:fs';
import { openPage, finish, check, OUTPUT_DIR } from '../helpers.mjs';

/** 撤销/重做、取消、崩溃恢复、.intx 往返：验证"信任底线"那几件事。 */
export async function run() {
  const { browser: b, page: p, errors: errs } = await openPage();
  const chips = () => p.locator('.toolbar').innerText().then((t) => t.replace(/\n/g, ' | '));
  const count = () => p.locator('.react-flow__node').count();

  // ── 1. 撤销 / 重做 ──
  await p.locator('.node-picker button').nth(0).click();
  await p.waitForTimeout(250);
  await p.locator('.node-picker button').nth(2).click();
  await p.waitForTimeout(500);
  console.log('1) 建两个节点后:', await count(), '节点');
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(250);
  const undone = await count();
  console.log('   Ctrl+Z →', undone, '节点');
  check(undone === 1, 'Ctrl+Z 应撤销最后一次新增');
  await p.keyboard.press('Control+Shift+z');
  await p.waitForTimeout(250);
  const redone = await count();
  console.log('   Ctrl+Shift+Z →', redone, '节点');
  check(redone === 2, 'Ctrl+Shift+Z 应重做');

  await p.locator('.node-picker button').last().click();
  await p.waitForTimeout(300);
  const cleared = await count();
  console.log('   清空画布 →', cleared, '节点');
  check(cleared === 0, '清空画布应移除全部节点');
  await p.locator('.toolbar button').first().click();
  await p.waitForTimeout(300);
  const restored = await count();
  console.log('   点撤销按钮 →', restored, '节点');
  check(restored === 2, '清空画布应可撤销');

  // ── 2. 取消生成 ──
  const nodes = p.locator('.react-flow__node');
  await nodes.nth(0).locator('textarea').fill('一只戴墨镜的橘猫');
  await p.waitForTimeout(250);
  const c = (bb) => ({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
  const from = c(await nodes.nth(0).locator('.react-flow__handle.source').first().boundingBox());
  const to = c(await nodes.nth(1).locator('.react-flow__handle.target').first().boundingBox());
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(from.x + 40, from.y + 30, { steps: 4 });
  await p.mouse.move(to.x, to.y, { steps: 16 });
  await p.mouse.up();
  await p.waitForTimeout(400);
  const edges = await p.locator('.react-flow__edge').count();
  console.log('2) 连线数:', edges);
  check(edges === 1, '应建立 1 条连线');

  await nodes.nth(1).locator('.node-generate-btn').click();
  await p.waitForTimeout(700);
  const runningBtn = await nodes.nth(1).locator('.node-generate-btn').innerText();
  console.log('   运行中按钮:', runningBtn);
  check(runningBtn === '取消', '运行中按钮应变为「取消」');
  await nodes.nth(1).locator('.node-generate-btn').click();
  await p.waitForTimeout(800);
  const canceled = (await nodes.nth(1).locator('.node-status').innerText().catch(() => '(无)')).replace(/\n/g, ' ');
  const afterBtn = await nodes.nth(1).locator('.node-generate-btn').innerText();
  console.log('   取消后状态:', canceled);
  console.log('   取消后按钮:', afterBtn);
  check(canceled.includes('已取消'), '取消后应是 canceled 终态而不是失败');
  check(afterBtn === '生成', '取消后按钮应恢复「生成」');

  // ── 3. 崩溃恢复：生成中途刷新 ──
  await nodes.nth(1).locator('.node-generate-btn').click();
  await p.waitForTimeout(900);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1800);
  const toolbar = await chips();
  console.log('3) 刷新后工具栏:', toolbar);
  check(toolbar.includes('上次有 1 个任务未跑完'), '应提示有未跑完的任务');
  console.log('   节点数:', await p.locator('.react-flow__node').count());
  const interrupted = await p.locator('.node-status.canceled').innerText().catch(() => '(无 canceled)');
  console.log('   生成节点状态:', interrupted);
  check(interrupted.includes('上次运行时应用退出'), '残留任务应收敛为带原因的「已取消」');

  // ── 4. 导出 / 导入 .intx ──
  const dlPromise = p.waitForEvent('download');
  await p.locator('.node-picker button', { hasText: '导出' }).click();
  const dl = await dlPromise;
  const path = OUTPUT_DIR + 'roundtrip.intx';
  await dl.saveAs(path);
  const text = readFileSync(path, 'utf8');
  const pkg = JSON.parse(text);
  console.log('4) 导出文件:', dl.suggestedFilename(), statSync(path).size, '字节');
  console.log('   格式:', pkg.format, 'v' + pkg.formatVersion, '| 节点:', pkg.project.nodes.length, '| 资产:', Object.keys(pkg.blobs).length);
  console.log('   含 apiKey?', text.includes('apiKey'));
  check(pkg.format === 'intx-project' && pkg.project.nodes.length === 2, '导出包格式与内容应正确');
  check(!text.includes('apiKey'), '导出包绝不能包含 apiKey');

  await p.locator('.node-picker button').last().click();
  await p.waitForTimeout(300);
  console.log('   清空后节点数:', await count());
  const chooser = p.waitForEvent('filechooser');
  await p.locator('.node-picker button', { hasText: '导入' }).click();
  (await chooser).setFiles(path);
  await p.waitForTimeout(1400);
  const imported = await count();
  const importedEdges = await p.locator('.react-flow__edge').count();
  console.log('   导入后节点数:', imported);
  console.log('   导入后连线数:', importedEdges);
  check(imported === 2 && importedEdges === 1, '导入应完整还原节点与连线');

  finish('撤销/取消/恢复/导入导出', errs);
  await b.close();
}
