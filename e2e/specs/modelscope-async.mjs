import { openPage, finish, check } from '../helpers.mjs';

/**
 * ModelScope 异步出图的真机等价验收（浏览器侧、假上游、零费用）。
 *
 * 真机缺陷：真实厂商扣了费，POST 2xx 只回 task_id，旧适配器把它当
 * 「上游返回了空结果」→ unknown → allowed → 卡片写「重置状态，原样重试
 * 是合理的」，用户点一下就再买一张。
 *
 * 这一组用 Playwright 路由伪造官方异步协议，验两件单测证明不了的事：
 *   A. 真实点击生成 → 真的走完 提交/轮询/下载 → 卡片出图；
 *   B. 上游 FAILED → 卡片按钮是「确认后重发」而不是「重置状态」，
 *      且任务里留住 task_id（upstreamRef），用户能去后台查单。
 *
 * 不发任何真实请求，不用真实 Key。
 */

const BASE = 'https://api-inference.modelscope.cn/v1';
const MODEL = 'openmoss/MOSS-Image-SFT';
const IMG = 'https://ms-images.test/a.png';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

export async function run() {
  const { browser: b, context: ctx, page: p, errors: errs } = await openPage();
  const cdp = await ctx.newCDPSession(p);

  let mode = 'succeed';
  const seen = { posts: 0, polls: 0, images: 0 };

  await p.route(/api-inference\.modelscope\.cn|ms-images\.test/, async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS, body: '' });
      return;
    }
    const reply = (status, body) =>
      route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    if (url.includes('/images/generations')) {
      seen.posts += 1;
      await reply(200, { task_id: 'task-e2e' });
      return;
    }
    if (url.includes('/tasks/')) {
      seen.polls += 1;
      await reply(
        200,
        mode === 'succeed'
          ? { task_status: 'SUCCEED', output_images: [IMG] }
          : { task_status: 'FAILED', error: { message: 'nsfw' } },
      );
      return;
    }
    if (url === IMG) {
      seen.images += 1;
      await route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'image/png' }, body: PNG });
      return;
    }
    await route.fulfill({ status: 404, headers: CORS, body: '' });
  });

  async function realClick(locator) {
    const bb = await locator.boundingBox();
    const x = bb.x + bb.width / 2;
    const y = bb.y + bb.height / 2;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  async function buildGraph() {
    await p.evaluate(async (model) => {
      const ps = await window.__intxMod('/src/app/stores/providerStore.ts');
      ps.useProviderStore.getState().upsert({
        id: 'ms-e2e',
        name: 'ModelScope 假上游',
        adapter: 'modelscope',
        baseUrl: 'https://api-inference.modelscope.cn/v1',
        apiKey: 'ms-fake-token-for-e2e',
        models: [{ id: model, label: model, capabilities: ['image'] }],
      });
      const g = await window.__intxMod('/src/app/stores/graphStore.ts');
      g.resetGraph();
      const text = g.addNode({ defKind: 'text-input', position: { x: 80, y: 80 } });
      const gen = g.addNode({ defKind: 'generate', position: { x: 520, y: 80 } });
      g.setNodeParam(text, 'content', '一只金色的猫坐在窗台上');
      g.setNodeParam(gen, 'model', model);
      g.connectNodes({
        sourceNodeId: text,
        sourcePortId: 'text',
        targetNodeId: gen,
        targetPortId: 'prompt',
      });
    }, MODEL);
    await p.waitForTimeout(350);
  }

  const snapshot = () =>
    p.evaluate(async () => {
      const t = await window.__intxMod('/src/app/stores/taskStore.ts');
      const { readTaskOutcome } = await window.__intxMod('/src/domain/task/outcome.ts');
      const tasks = Object.values(t.useTaskStore.getState().tasks);
      const last = tasks[tasks.length - 1];
      return {
        status: last?.status ?? null,
        code: last?.error?.code ?? null,
        message: last?.error?.message ?? null,
        upstreamRef: last?.upstreamRef ?? null,
        results: last?.resultAssetIds?.length ?? 0,
        outcome: readTaskOutcome(last),
      };
    });

  async function waitTerminal(timeoutMs = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const s = await snapshot();
      if (s.status && ['succeeded', 'failed', 'canceled'].includes(s.status)) return s;
      await p.waitForTimeout(250);
    }
    return snapshot();
  }

  // ── A. 异步成功：真的出图 ──
  await buildGraph();
  mode = 'succeed';
  await realClick(p.locator('.react-flow__node').nth(1).locator('.node-generate-btn'));
  const a = await waitTerminal();
  console.log('【A 异步成功】', JSON.stringify({ ...a, seen: { ...seen } }));
  check(a.status === 'succeeded', `A1 异步任务应成功，实际 ${a.status} / ${a.code} / ${a.message}`);
  check(a.results === 1, `A2 应有 1 个产物，实际 ${a.results}`);
  check(seen.posts === 1 && seen.polls >= 1 && seen.images === 1, 'A3 应提交 1 次、轮询并下载 1 张图');

  // ── B. 上游 FAILED：不许说「重置状态」，且留住任务号 ──
  mode = 'failed';
  await p.evaluate(async () => {
    const t = await window.__intxMod('/src/app/stores/taskStore.ts');
    t.useTaskStore.setState({ tasks: {} });
  });
  await buildGraph();
  await realClick(p.locator('.react-flow__node').nth(1).locator('.node-generate-btn'));
  const f = await waitTerminal();
  const btn = await p.locator('.node-status.failed .link-btn').first().innerText().catch(() => '(无)');
  const hint = await p.locator('.node-status.failed').first().innerText().catch(() => '(无)');
  console.log('【B 已收单失败】', JSON.stringify({ ...f, btn, hint: hint.replace(/\n/g, ' ') }));

  check(f.status === 'failed' && f.code === 'provider_result_pending', `B1 应判已收单待确认，实际 ${f.code}`);
  check(f.upstreamRef === 'task-e2e', `B2 任务号应留在 upstreamRef，实际 ${f.upstreamRef}`);
  check(f.outcome?.regenerate === 'confirm', `B3 三态应为 confirm，实际 ${JSON.stringify(f.outcome)}`);
  check(btn.includes('确认后重发') && !btn.includes('重置状态'), `B4 按钮不许诱导直接重发，实际「${btn}」`);
  check(hint.includes('厂商后台') || hint.includes('任务号'), 'B5 卡片应告诉用户去厂商后台查单');

  finish('ModelScope 异步出图：成功链路与已收单止血', errs);
  await b.close();
}
