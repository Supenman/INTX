import { openPage, finish, check } from '../helpers.mjs';

/**
 * P3：提示词里的 `@资产` 引用。
 *
 * 单测已经把解析、剥离、内联、缺失这几条纯逻辑钉死了。这一组只测
 * **单测证明不了的事**：
 *
 * - 敲 `@` 面板真的弹出来，Enter 真的把 token 插进光标处（不是插到末尾）；
 * - 卡片把 token 渲染成 chip 而不是摊一串 `asset:as_xxx`；
 * - 真正发出去的任务里 prompt **已被剥离**、`inputAssetIds` **真的带上了那张图**；
 * - 引用了不存在的资产时会被拦下并说清原因，而不是静默发一个没有参考图的请求。
 *
 * 最后一条是本组存在的理由：静默跳过是这个功能最容易犯、也最难被发现的错。
 */
export async function run() {
  const { page: p, errors: errs } = await openPage();
  const editor = () => p.locator('[data-testid="prompt-editor-textarea"]');
  const mask = () => p.locator('.panel-mask');
  const openEditor = async () => {
    await p.locator('[data-testid="prompt-expand"]').first().click();
    await mask().waitFor();
    await p.waitForTimeout(200);
  };

  /** 等最新任务落定，返回它的快照。 */
  const waitLastTask = async () => {
    for (let i = 0; i < 40; i += 1) {
      const t = await p.evaluate(async () => {
        const s = await window.__intxMod('/src/app/stores/taskStore.ts');
        const all = Object.values(s.useTaskStore.getState().tasks);
        const last = all.sort((a, b) => b.createdAt - a.createdAt)[0];
        return last ? { status: last.status, prompt: last.params.prompt, inputAssetIds: last.params.inputAssetIds } : null;
      });
      if (t && (t.status === 'succeeded' || t.status === 'failed' || t.status === 'canceled')) return t;
      await p.waitForTimeout(400);
    }
    return null;
  };

  // ── 1. 资产库为空时，面板要说清"是空的"，而不是假装在筛 ──────────
  await p.locator('.sidebar .node-picker button', { hasText: '生成' }).first().click();
  await p.waitForTimeout(500);
  await openEditor();
  await editor().click();
  await p.keyboard.type('@');
  await p.waitForTimeout(300);
  check((await p.locator('[data-testid="asset-pick"]').count()) === 1, '敲 @ 应弹出资产面板');
  const emptyHint = await p.locator('.asset-pick-empty').innerText();
  check(emptyHint.includes('资产库'), `空资产库时提示应指向资产库，实际「${emptyHint}」`);

  // ── 2. 先生成一张图，才有东西可引用 ────────────────────────────
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  await editor().click();
  await p.keyboard.press('Control+a');
  await p.keyboard.type('雨夜街口，积水反光');
  await p.keyboard.press('Control+Enter');
  await p.waitForTimeout(600);
  const first = await waitLastTask();
  check(first?.status === 'succeeded', `首张图应生成成功，实际 ${first?.status}`);
  check(first?.prompt === '雨夜街口，积水反光', '不带引用的提示词必须原样发出，不能被改写');

  // ── 3. 敲 @ → 面板列出刚生成的图 → Enter 插入到光标处 ────────────
  await openEditor();
  await editor().click();
  await p.keyboard.press('Control+a');
  await p.keyboard.type('照着这张的质感再来一张 @');
  await p.waitForTimeout(400);
  const items = p.locator('.asset-pick-item');
  check((await items.count()) >= 1, `面板应列出可引用资产，实际 ${await items.count()} 个`);
  const pickLabel = (await items.first().innerText()).trim();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  const typed = await editor().inputValue();
  check(typed.includes('@[') && typed.includes('](asset:'), `Enter 应把引用 token 插进文本，实际「${typed}」`);
  check(!typed.includes('@@'), '插入时要把光标前那个 @ 一起替换掉，不能留下两个 @');
  check(typed.startsWith('照着这张的质感再来一张 @['), 'token 必须落在光标处，不能被追加到末尾');

  // ── 4. 卡片上渲染成 chip，不摊开原始语法 ────────────────────────
  check((await p.locator('[data-testid="asset-pick"]').count()) === 0, '插入后面板应收起');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  check((await p.locator('.prompt-ref').count()) === 1, '卡片上应出现一个引用 chip');
  const chip = (await p.locator('.prompt-ref').first().innerText()).trim();
  check(chip === pickLabel, `chip 文案应与面板一致（面板「${pickLabel}」，chip「${chip}」）`);
  check(!chip.includes('asset:'), 'chip 里不应露出内部 id');

  // ── 5. 真发出去的任务：prompt 已剥离，参考图真的带上了 ────────────
  await openEditor();
  await editor().click();
  await p.keyboard.press('Control+End');
  await p.keyboard.press('Control+Enter');
  await p.waitForTimeout(600);
  const second = await waitLastTask();
  check(second?.status === 'succeeded', `带引用的生成应成功，实际 ${second?.status}`);
  check(
    second !== null && !String(second.prompt).includes('@['),
    `发出去的提示词必须剥掉引用语法，实际「${second?.prompt}」`,
  );
  check(
    second?.prompt === '照着这张的质感再来一张',
    `剥离后应留下干净文本，实际「${second?.prompt}」`,
  );
  check(
    Array.isArray(second?.inputAssetIds) && second.inputAssetIds.length === 1,
    `引用的图应进入 inputAssetIds，实际 ${JSON.stringify(second?.inputAssetIds)}`,
  );

  // ── 6. 引用不存在的资产：拦下并说清，不许静默跳过 ────────────────
  await openEditor();
  await editor().click();
  await p.keyboard.press('Control+a');
  await p.keyboard.type('用 @[幽灵图](asset:as_nope) 做参考');
  await p.keyboard.press('Control+Enter');
  await p.waitForTimeout(900);
  // 错误提示走的是画布顶部的 conn-error（不是右下角那条 flash），
  // 5.2 秒后自己消失，所以这里马上读。
  const toast = await p.locator('[role="alert"]').innerText().catch(() => '');
  check(toast.includes('不存在'), `引用不存在的资产应明确报错，实际提示「${toast}」`);
  const third = await p.evaluate(async () => {
    const s = await window.__intxMod('/src/app/stores/taskStore.ts');
    return Object.keys(s.useTaskStore.getState().tasks).length;
  });
  check(third === 2, `被拦下的请求不应产生任务，实际任务数 ${third}`);

  // ── 7. Esc 关掉面板后继续打字，不能又弹出来 ──────────────────────
  await openEditor();
  await editor().click();
  await p.keyboard.press('Control+a');
  await p.keyboard.type('再来一张 @');
  await p.waitForTimeout(300);
  check((await p.locator('[data-testid="asset-pick"]').count()) === 1, '敲 @ 应弹面板');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  check((await p.locator('[data-testid="asset-pick"]').count()) === 0, 'Esc 应先收起面板');
  check((await p.locator('.panel-mask').count()) === 1, 'Esc 收面板时不该顺手把整个编辑器关掉');
  await p.keyboard.type('街口');
  await p.waitForTimeout(300);
  check(
    (await p.locator('[data-testid="asset-pick"]').count()) === 0,
    'Esc 放弃后继续打字不该让面板复弹（否则用户会以为 Esc 不管用）',
  );

  finish('@资产 引用', errs);
}
