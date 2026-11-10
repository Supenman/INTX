import { readFileSync } from 'node:fs';
import { openPage, finish, check, OUTPUT_DIR } from '../helpers.mjs';

/**
 * 素材编辑：裁切 + 遮罩 + 放大 + 刷新恢复。
 *
 * 最后一条断言是本组的关键：以前自动保存只订阅画布变化，
 * 编辑产物只加资产、不碰节点，刷新后会凭空消失。
 * 放大这一栏同时验证「后端如实标注」：浏览器里没有桌面壳与模型，
 * 必须回退并显示「演示级 · 非 AI」，不许把插值放大包装成超分。
 */
const PNG_MAGIC = '89504e470d0a1a0a';

function pngInfo(path) {
  const buf = readFileSync(path);
  return {
    bytes: buf.length,
    magic: buf.subarray(0, 8).toString('hex'),
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

export async function run() {
  const { browser: b, context: ctx, page: p, errors: errs } = await openPage();
  const cdp = await ctx.newCDPSession(p);

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
    await p.mouse.move(from.x + 20, from.y + 15, { steps: 4 });
    await p.mouse.move(to.x, to.y, { steps: 16 });
    await p.waitForTimeout(120);
    await p.mouse.up();
    await p.waitForTimeout(350);
  }

  const center = (bb) => ({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });

  // ── 1. 先出一张图 ──
  await p.locator('.node-picker button').nth(0).click();
  await p.waitForTimeout(250);
  await p.locator('.node-picker button').nth(2).click();
  await p.waitForTimeout(900);
  const nodes = p.locator('.react-flow__node');
  await nodes.nth(0).locator('textarea').fill('雨后的巷口，一盏还亮着的路灯');
  await drag(
    center(await nodes.nth(0).locator('.react-flow__handle.source').first().boundingBox()),
    center(await nodes.nth(1).locator('.react-flow__handle.target').first().boundingBox()),
  );
  await realClick(nodes.nth(1).locator('.node-generate-btn'));
  await p.waitForTimeout(5000);
  const before = await p.locator('.asset-thumb').count();
  console.log('1) 生成后资产数:', before);
  check(before === 1, '演示生成应产出 1 张图');

  // ── 2. 打开素材编辑器 ──
  await p.locator('.asset-thumb').first().click();
  await p.locator('.preview').waitFor();
  await p.locator('.preview-edit').click();
  await p.locator('.material-canvas').waitFor();
  const label = await p.locator('.material-head .mono').innerText();
  const dims = (label.match(/\d+/g) ?? []).map(Number);
  const srcW = dims[0] ?? 0;
  const srcH = dims[1] ?? 0;
  console.log(`2) 编辑器原图: ${label}`);
  check(srcW > 100 && srcH > 100, '编辑器应显示原图尺寸');

  // ── 3. 16:9 裁切：输出像素比必须真的是 16:9 ──
  await p.locator('.material-aspect[data-aspect="16:9"]').click();
  const box = await p.locator('.material-canvas').boundingBox();
  await drag(
    { x: box.x + box.width * 0.15, y: box.y + box.height * 0.15 },
    { x: box.x + box.width * 0.75, y: box.y + box.height * 0.75 },
  );
  const cropDl = p.waitForEvent('download');
  await p.locator('.material-primary').click();
  const cropFile = await cropDl;
  const cropPath = OUTPUT_DIR + 'material-crop.png';
  await cropFile.saveAs(cropPath);
  const crop = pngInfo(cropPath);
  console.log(`3) 裁切: ${cropFile.suggestedFilename()} ${crop.bytes} 字节 ${crop.width}x${crop.height}`);
  check(crop.magic === PNG_MAGIC, '裁切结果应是有效 PNG');
  check(Math.abs(crop.width / crop.height - 16 / 9) < 0.06, '16:9 裁切的输出像素比应接近 16:9');
  check(crop.width < srcW || crop.height < srcH, '裁切结果应比原图小');
  await p.waitForTimeout(400);
  const afterCrop = await p.locator('.asset-thumb').count();
  console.log('   资产数:', afterCrop);
  check(afterCrop === before + 1, '裁切产物应进入资产库');
  await p.screenshot({ path: OUTPUT_DIR + 'material-editor.png' });

  // ── 4. 遮罩：尺寸必须等于原图 ──
  await p.locator('.material-tabs button').nth(1).click();
  const box2 = await p.locator('.material-canvas').boundingBox();
  await drag(
    { x: box2.x + box2.width * 0.2, y: box2.y + box2.height * 0.3 },
    { x: box2.x + box2.width * 0.8, y: box2.y + box2.height * 0.62 },
  );
  const strokeLabel = await p.locator('.material-tools .mono').innerText();
  console.log('4) 笔迹:', strokeLabel);
  check(strokeLabel.includes('1 笔'), '拖拽应留下 1 笔遮罩');
  const maskDl = p.waitForEvent('download');
  await p.locator('.material-primary').click();
  const maskFile = await maskDl;
  const maskPath = OUTPUT_DIR + 'material-mask.png';
  await maskFile.saveAs(maskPath);
  const mask = pngInfo(maskPath);
  console.log(`   蒙版: ${maskFile.suggestedFilename()} ${mask.bytes} 字节 ${mask.width}x${mask.height}`);
  check(mask.magic === PNG_MAGIC, '蒙版应是有效 PNG');
  check(mask.width === srcW && mask.height === srcH, '蒙版尺寸必须与原图一致');
  await p.waitForTimeout(400);
  const afterMask = await p.locator('.asset-thumb').count();
  console.log('   资产数:', afterMask);
  check(afterMask === before + 2, '蒙版也应进入资产库');

  // ── 5. 放大：浏览器里回退参考实现，尺寸严格等于原图 × 2 ──
  await p.locator('.material-tabs button').nth(2).click();
  await p.locator('.upscale-panel').waitFor();
  await p.waitForFunction(() => {
    const b = document.querySelector('.material-primary');
    return b instanceof HTMLButtonElement && !b.disabled;
  });
  const backendText = (await p.locator('.upscale-backend').innerText()).replace(/\s+/g, ' ');
  console.log('5) 超分后端:', backendText.slice(0, 140));
  check(backendText.includes('参考重采样') || backendText.includes('本地 ONNX'), '应显示当前生效的放大后端');
  check(backendText.includes('演示级'), '回退实现必须如实标注非 AI');
  const missingText = (await p.locator('.upscale-missing').innerText()).replace(/\s+/g, ' ');
  console.log('   待补齐:', missingText.slice(0, 140));
  check(missingText.includes('Tauri') || missingText.includes('桌面'), '应列出正式路线还差什么');

  const upDl = p.waitForEvent('download');
  await p.locator('.material-primary').click();
  const upFile = await upDl;
  const upPath = OUTPUT_DIR + 'material-upscale.png';
  await upFile.saveAs(upPath);
  const up = pngInfo(upPath);
  console.log(`   放大: ${upFile.suggestedFilename()} ${up.bytes} 字节 ${up.width}x${up.height}`);
  check(up.magic === PNG_MAGIC, '放大结果应是有效 PNG');
  check(up.width === srcW * 2 && up.height === srcH * 2, '2× 放大尺寸必须严格等于原图 × 2');
  await p.waitForTimeout(500);
  const afterUp = await p.locator('.asset-thumb').count();
  console.log('   资产数:', afterUp);
  check(afterUp === before + 3, '放大产物应进入资产库');
  await p.screenshot({ path: OUTPUT_DIR + 'material-upscale-ui.png' });

  // ── 6. 刷新恢复：三类编辑产物都不能丢 ──
  await p.locator('.material-head .icon-btn').click();
  await p.waitForTimeout(1400);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
  const afterReload = await p.locator('.asset-thumb').count();
  console.log('6) 刷新后资产数:', afterReload);
  check(afterReload === before + 3, '编辑/放大产物必须随项目文件恢复，而不是只活在内存里');
  await p.screenshot({ path: OUTPUT_DIR + 'material-reload.png' });

  finish('素材编辑', errs);
  await b.close();
}
