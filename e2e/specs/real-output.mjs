import { readFileSync } from 'node:fs';
import { openPage, finish, check, OUTPUT_DIR } from '../helpers.mjs';

/**
 * 端到端真实产出场景：6 格分镜 → 第 3 格上游 429 → 点失败卡片重发
 * → 只补缺失格 → 导出可交付文件组 → 关掉重开还在。
 *
 * 这一组不是"功能清单"，而是把用户真正会做的一件事从头跑到底。
 * 验收标准来自 intx-development-plan.md 阶段 1 的 1.1 / 1.2：
 *   - 失败卡片点重试 → 恰好发起一次真实执行
 *   - 四格分镜第三格失败 → 节点与台账均显示前两格产物
 *   - 补生成只请求缺失格，不重复前两格
 *   - 重启后补格进度保持
 *
 * 故障注入走生产代码自己提供的 registerAdapter()，不改任何源码：
 * 第 3 次 generate 调用抛 429，其余正常出图。
 */

const GRID = '3x2'; // 6 格
const SCRIPT = [
  '雨夜天台，少女背对镜头望向城市',
  '她转身，眼里映着霓虹',
  '一只黑猫跳上栏杆，远处雷声',
  '警灯扫过积水，她抬头',
  '便利店招牌亮起，雨小了',
  '天亮，她走下楼梯',
].join('\n');

const PNG_MAGIC = '89504e470d0a1a0a';

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
    await p.mouse.move(from.x + 40, from.y + 30, { steps: 4 });
    await p.mouse.move(to.x, to.y, { steps: 16 });
    await p.waitForTimeout(120);
    await p.mouse.up();
    await p.waitForTimeout(400);
  }
  const center = (bb) => ({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });

  const snapshot = () =>
    p.evaluate(async () => {
      const t = await window.__intxMod('/src/app/stores/taskStore.ts');
      const g = await window.__intxMod('/src/app/stores/graphStore.ts');
      const tasks = Object.values(t.useTaskStore.getState().tasks);
      const last = tasks[tasks.length - 1];
      const sb = Object.values(g.useGraphStore.getState().nodes).find((n) => n.defKind === 'storyboard');
      return {
        taskCount: tasks.length,
        totalResults: tasks.reduce((n, x) => n + (x.resultAssetIds?.length ?? 0), 0),
        status: last?.status ?? null,
        phase: last?.phase ?? null,
        code: last?.error?.code ?? null,
        message: last?.error?.message ?? null,
        results: last?.resultAssetIds?.length ?? 0,
        attempt: last?.attempt ?? 0,
        derived: sb?.derivedAssetIds?.length ?? 0,
        calls: window.__genCalls?.length ?? -1,
      };
    });

  async function waitTerminal(timeoutMs = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const s = await snapshot();
      if (s.taskCount > 0 && ['succeeded', 'failed', 'canceled'].includes(s.status)) return s;
      await p.waitForTimeout(300);
    }
    return await snapshot();
  }

  // ── 0. 注册可计数、可在第 3 格失败的适配器 ──
  await p.evaluate(async () => {
    const prov = await window.__intxMod('/src/infra/provider/index.ts');
    const orig = prov.mockAdapter;
    window.__genCalls = [];
    window.__failCall = 3;
    prov.registerAdapter('mock', {
      kind: 'mock',
      test: (c) => orig.test(c),
      generate: async (config, request, handlers) => {
        window.__genCalls.push(request.prompt);
        if (window.__failCall !== null && window.__genCalls.length === window.__failCall) {
          handlers.onPhase?.('generating');
          await new Promise((r) => setTimeout(r, 250));
          throw new Error('429 rate limit exceeded');
        }
        return orig.generate(config, request, handlers);
      },
    });
  });

  // ── 1. 真实摆图：文字输入 → 分镜宫格 ──
  await p.locator('.node-picker button').nth(0).click();
  await p.waitForTimeout(250);
  await p.locator('.node-picker button').nth(3).click();
  await p.waitForTimeout(900);
  let nodes = p.locator('.react-flow__node');
  check((await nodes.count()) === 2, '应有文字输入 + 分镜宫格两个节点');

  // 宫格规格在 UI 上只读（方案 P11），这里直接改节点参数，同时把这个限制记下来
  const gridSet = await p.evaluate(async (grid) => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const sb = Object.values(g.useGraphStore.getState().nodes).find((n) => n.defKind === 'storyboard');
    if (!sb) return false;
    g.setNodeParam(sb.id, 'grid', grid);
    return true;
  }, GRID);
  check(gridSet, '应能把分镜规格设成 3x2');

  await nodes.nth(0).locator('textarea').fill(SCRIPT);
  await p.waitForTimeout(300);
  await drag(
    center(await nodes.nth(0).locator('.react-flow__handle.source').first().boundingBox()),
    center(await nodes.nth(1).locator('.react-flow__handle.target').first().boundingBox()),
  );
  check((await p.locator('.react-flow__edge').count()) === 1, '文字输入应连到分镜宫格');

  // ── 2. 点「拆分」，等第 3 格 429 ──
  await realClick(nodes.nth(1).locator('.node-generate-btn'));
  const afterFail = await waitTerminal();
  const cellsAfterFail = await nodes.nth(1).locator('.grid-cell').count();
  const failBtn = await p
    .locator('.node-status.failed .link-btn')
    .first()
    .innerText()
    .catch(() => '(无重发按钮)');
  console.log('【A 第 3 格失败后】', JSON.stringify({ ...afterFail, cells: cellsAfterFail, failBtn }));

  // ── 3. 点失败卡片上的重发，看是否真的发起一次执行 ──
  await p.evaluate(() => {
    window.__failCall = null; // 补格阶段让上游恢复正常
  });
  const retryBtn = p.locator('.node-status.failed .link-btn').first();
  const hadRetry = (await retryBtn.count()) > 0;
  if (hadRetry) await retryBtn.click();
  await p.waitForTimeout(900);
  const afterRetry = await snapshot();
  const genBtnText = await nodes.nth(1).locator('.node-generate-btn').innerText().catch(() => '(无按钮)');
  console.log('【B 点重发后】', JSON.stringify({ ...afterRetry, genBtnText, hadRetry }));

  // ── 4. 补格跑完（如果 B 没卡死），看是否只补缺失格 ──
  let afterRepair = null;
  if (afterRetry.status === 'running' || afterRetry.status === 'succeeded') {
    afterRepair = await waitTerminal(40000);
  }
  const cellsAfterRepair = await nodes.nth(1).locator('.grid-cell').count();
  console.log('【C 补格后】', JSON.stringify({ ...(afterRepair ?? {}), cells: cellsAfterRepair }));

  // ── 5. 导出可交付文件组（拼图 PNG + .intx 项目包） ──
  let deliverables = { gridPng: null, intx: null };
  try {
    const gridBtn = nodes.nth(1).locator('.node-secondary-btn');
    if ((await gridBtn.count()) > 0) {
      const dl = p.waitForEvent('download', { timeout: 10000 });
      await gridBtn.click();
      const f = await dl;
      const path = OUTPUT_DIR + 'real-output-grid.png';
      await f.saveAs(path);
      const buf = readFileSync(path);
      deliverables.gridPng = { name: f.suggestedFilename(), bytes: buf.length, magic: buf.subarray(0, 8).toString('hex') };
    }
    const dl2 = p.waitForEvent('download', { timeout: 10000 });
    await p.evaluate(async () => {
      const pkg = await window.__intxMod('/src/app/useCases/projectPackage.ts');
      await pkg.exportProject();
    });
    const f2 = await dl2;
    const path2 = OUTPUT_DIR + 'real-output.intx';
    await f2.saveAs(path2);
    deliverables.intx = { name: f2.suggestedFilename(), bytes: readFileSync(path2).length };
  } catch (e) {
    deliverables.error = String(e?.message ?? e).slice(0, 160);
  }
  console.log('【D 导出】', JSON.stringify(deliverables));

  // ── 6. 等自动保存落地，再重开 ──
  // 600ms 防抖：真实用户关应用前会经过这一步；spec 是瞬间 reload，
  // 不等就会把「还没写进存档」误判成「刷新丢数据」。同时把「已保存」
  // 当成验收项：没出现说明订阅根本没被触发，那才是真缺陷。
  await p.waitForTimeout(1000);
  const saveChips = (await p.locator('.chip').allInnerTexts()).filter((x) =>
    /已保存|保存中|保存失败/.test(x),
  );
  console.log('【E0 保存状态】', JSON.stringify(saveChips));

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
  const reloaded = {
    nodes: await p.locator('.react-flow__node').count(),
    edges: await p.locator('.react-flow__edge').count(),
    cells: await p.locator('.grid-cell').count(),
    assets: await p.locator('.asset-thumb').count(),
  };
  console.log('【E 刷新还原】', JSON.stringify(reloaded));

  // ── 统一断言：按方案的目标行为，红了就是真实卡点 ──
  const findings = [];
  const expect = (cond, label) => {
    if (!cond) findings.push(label);
  };
  expect(cellsAfterFail === 2, 'A1 第 3 格失败后节点应保留前 2 格产物');
  expect(afterFail.results === 2, 'A2 任务层 resultAssetIds 应记录前 2 格部分产物（台账才不会显示零产物）');
  expect(failBtn.includes('已出的保留'), 'A3 失败卡片应提示「已出的保留」而不是笼统的「重置状态」');
  expect(hadRetry, 'B0 失败卡片应有重发按钮');
  expect(
    afterRetry.status === 'running' || afterRetry.status === 'succeeded',
    'B1 点重发后应真正发起一次执行，而不是停在 queued 让按钮变成「取消」',
  );
  expect(afterRetry.calls > 3, 'B2 点重发后应观察到新的上游请求');
  expect(afterRepair?.totalResults === 6, 'C1 两次任务合计应有 6 个产物（失败任务 2 + 补格任务 4）');
  expect(
    afterRetry.calls > 3 && afterRetry.calls <= 7 && afterRepair?.calls === 7,
    'C2 补格只应请求后 4 格，不重复已出的前 2 格',
  );
  expect(cellsAfterRepair === 6, 'C3 补格后节点应显示 6 格');
  expect(deliverables.gridPng?.magic === PNG_MAGIC, 'D1 应能导出有效拼图 PNG');
  expect(deliverables.intx?.bytes > 1000, 'D2 应能导出 .intx 项目包');
  expect(saveChips.some((x) => x.includes('已保存')), 'E0 刷新前自动保存应已完成并显示为「已保存」');
  expect(reloaded.nodes === 2 && reloaded.edges === 1 && reloaded.cells === 6, 'E1 刷新后图/连线/分格应完整还原');

  console.log(`【卡点 ${findings.length} 条】`);
  findings.forEach((f) => console.log('  ✗ ' + f));
  finish('真实产出：分镜部分失败→补格→交付', errs);
  check(findings.length === 0, `真实产出场景仍有 ${findings.length} 条未达标：\n  - ${findings.join('\n  - ')}`);
  await b.close();
}
