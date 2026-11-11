import { openPage, finish, check } from '../helpers.mjs';

/**
 * 提示词放大编辑（P3 第一项）。
 *
 * 单测证明 promptEditorState / promptLength 算得对，但证明不了下面这些只有
 * 浏览器才知道的事：浮层真的铺满视口（而不是被 ReactFlow 的 transform 困在
 * 节点里）、Esc 真的关掉、写完真的回写到节点、上游连线时输入框真的只读、
 * 只读时改不动、Ctrl+Enter 真的触发一次生成。
 *
 * 这里刻意不测「卡片上显示的文字对不对」——那是 §6.9 缺陷二的地盘，
 * 已经由 tool-registry 那组钉住了，重复断言只会让失败信息互相干扰。
 */
export async function run() {
  const { browser: b, page: p, errors: errs } = await openPage();
  const nodes = () => p.locator('.react-flow__node');
  const editor = () => p.locator('[data-testid="prompt-editor-textarea"]');
  const mask = () => p.locator('.panel-mask');
  const cardPrompt = (i) => p.locator('[data-testid="node-prompt"]').nth(i);

  const center = (bb) => ({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
  const drag = async (fromLoc, toLoc) => {
    const from = center(await fromLoc.boundingBox());
    const to = center(await toLoc.boundingBox());
    await p.mouse.move(from.x, from.y);
    await p.mouse.down();
    await p.mouse.move(from.x + 40, from.y + 20, { steps: 4 });
    await p.mouse.move(to.x, to.y, { steps: 16 });
    await p.waitForTimeout(120);
    await p.mouse.up();
    await p.waitForTimeout(400);
  };

  // ── 1. 从卡片点开，浮层铺满视口 ──
  await p.locator('.node-picker button', { hasText: '生成' }).first().click();
  await p.waitForTimeout(400);
  check((await nodes().count()) === 1, '应只有一个生成节点');

  await p.locator('[data-testid="prompt-expand"]').first().click();
  await mask().waitFor();
  const box = await mask().boundingBox();
  const vp = p.viewportSize();
  // 这条断言是给「portal 忘了写」准备的：不 portal 的话遮罩会被 ReactFlow
  // 的 transform 缩在节点盒子里（实测过 340×380），用户会看到一个迷你弹窗。
  check(
    box.width >= vp.width - 2 && box.height >= vp.height - 2,
    `浮层应铺满视口（得到 ${Math.round(box.width)}×${Math.round(box.height)}，视口 ${vp.width}×${vp.height}）`,
  );

  // ── 2. 输入回写节点，且字数跟着变 ──
  const longText = '雨夜霓虹街口，35mm 抓拍质感，湿漉漉的柏油路面反射着招牌的红绿光';
  await editor().fill(longText);
  await p.waitForTimeout(200);
  const countText = await p.locator('.prompt-editor-count').innerText();
  check(countText.startsWith(`${[...longText].length} 字`), `字数应实时更新（得到「${countText}」）`);

  // ── 3. Esc 关闭且内容不丢 ──
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  check((await mask().count()) === 0, 'Esc 应关掉浮层');
  await p.waitForTimeout(200);
  check(
    (await cardPrompt(0).innerText()).includes('雨夜霓虹街口'),
    '关掉浮层后卡片上应显示刚写的内容（即改即生效，没有「保存」按钮）',
  );

  // ── 4. 上游连线时：只读、显示上游那段、本地草稿仍然保留 ──
  await p.locator('.node-picker button', { hasText: '文字输入' }).first().click();
  await p.waitForTimeout(500);
  check((await nodes().count()) === 2, '应有文字节点与生成节点');
  await p.locator('.node-textarea').first().fill('上游提供的一段场景描述');
  await p.waitForTimeout(400);

  const textNode = nodes().filter({ has: p.locator('.node-textarea') });
  const genNode = nodes().filter({ has: p.locator('[data-testid="prompt-expand"]') });
  await drag(
    textNode.locator('.react-flow__handle.source').first(),
    genNode.locator('.react-flow__handle.target').first(),
  );
  check((await p.locator('.react-flow__edge').count()) === 1, '应连出一条边');

  await p.locator('[data-testid="prompt-expand"]').first().click();
  await mask().waitFor();
  const ro = await editor().getAttribute('readonly');
  check(ro !== null, '上游有内容时输入框必须是只读的，否则用户改了会以为生效了');
  check((await editor().inputValue()) === '上游提供的一段场景描述', '只读框里应显示上游那段文字');
  check((await p.locator('[data-testid="upstream-note"]').count()) === 1, '应说明这段来自上游');
  check(
    (await p.locator('.prompt-editor-note').innerText()).includes('草稿仍然保留'),
    '上游接上后应告诉用户自己的草稿没丢',
  );

  // 只读态真的改不动。不能用 fill()：Playwright 对 readonly 元素会一直等到
  // 超时，失败信息是「element is not editable」而不是断言失败，很难读懂。
  // 改成聚焦后真的敲键盘——这更接近用户的实际操作，也真的验证了改不动。
  await editor().click();
  await p.keyboard.type('试图覆盖上游内容');
  await p.waitForTimeout(200);
  check((await editor().inputValue()) === '上游提供的一段场景描述', '只读框不应被键盘输入改动');

  // ── 5. 「抄到本地草稿」可用，且不会把浮层一起关掉 ──
  await p.locator('.prompt-editor-note .link-btn').click();
  await p.waitForTimeout(300);
  check((await mask().count()) === 1, '点抄写不应关掉整个浮层（遮罩只在按下和抬起都在遮罩上时才关）');
  check(
    (await p.locator('.prompt-editor-note .link-btn').innerText()).includes('已抄到'),
    '抄写后应给出可见反馈',
  );

  // ── 6. Ctrl+Enter 关浮层并生成 ──
  const tasksBefore = await p.evaluate(async () => {
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    return Object.keys(t.useTaskStore.getState().tasks).length;
  });
  await editor().click();
  await p.keyboard.press('Control+Enter');
  await p.waitForTimeout(2500);
  check((await mask().count()) === 0, 'Ctrl+Enter 应关掉浮层');
  const tasksAfter = await p.evaluate(async () => {
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    return Object.keys(t.useTaskStore.getState().tasks).length;
  });
  check(tasksAfter > tasksBefore, `Ctrl+Enter 应触发一次生成（任务 ${tasksBefore} → ${tasksAfter}）`);

  // ── 7. 空提示词时「保存并生成」置灰 ──
  // 用一个新的孤立生成节点：只有它既没连线也没有本地草稿，
  // 才真的是「空提示词」状态。拿上面那个节点测会带着上游/草稿内容。
  await p.locator('.node-picker button', { hasText: '生成' }).first().click();
  await p.waitForTimeout(500);
  const bare = nodes().filter({ has: p.locator('[data-testid="node-prompt"] .node-empty') });
  check((await bare.count()) >= 1, '应有一个显示「还没有提示词」的孤立生成节点');
  await bare.first().locator('[data-testid="prompt-expand"]').click();
  await mask().waitFor();
  check((await editor().inputValue()) === '', '孤立节点打开编辑器应是空的');
  check(
    await p.locator('.prompt-editor-actions .btn.primary').isDisabled(),
    '提示词为空时「保存并生成」应置灰，而不是让用户点了才发现没反应',
  );

  finish('提示词放大编辑', errs);
  await b.close();
}
