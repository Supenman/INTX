import { openPage, finish, check, OUTPUT_DIR } from '../helpers.mjs';

/** 200 节点压力：布局、拖拽、缩放、撤销、刷新恢复。曾逼出网格行数写死的 bug。 */
export async function run() {
  const { browser: b, page: p, errors: errs } = await openPage();
  const domCount = () => p.locator('.react-flow__node').count();
  const storeCount = () =>
    p.evaluate(async () => {
      const m = await window.__intxMod('/src/app/stores/graphStore.ts');
      return Object.keys(m.useGraphStore.getState().nodes).length;
    });

  // ── 0. 确认注入的是页面自己那个 store 单例 ──
  await p.locator('.node-picker button').nth(0).click();
  await p.waitForTimeout(300);
  const same = await storeCount();
  console.log('0) store 单例: DOM=' + (await domCount()) + ', store=' + same + (same === 1 ? ' ✅' : ' ❌'));
  check(same === 1, '动态 import 必须拿到页面同一个 store 实例');

  const TARGET = 200;
  const kinds = ['text-input', 'asset', 'generate', 'storyboard'];
  const t0 = Date.now();
  for (let base = 0; base < TARGET - 1; base += 25) {
    const batch = Math.min(25, TARGET - 1 - base);
    await p.evaluate(
      async ({ batch, base, kinds }) => {
        const m = await window.__intxMod('/src/app/stores/graphStore.ts');
        for (let i = 0; i < batch; i += 1) {
          m.addNode({ defKind: kinds[(base + i) % kinds.length], position: { x: 0, y: 0 } });
        }
      },
      { batch, base, kinds },
    );
    await p.waitForTimeout(120);
  }
  const tAdd = Date.now() - t0;
  await p.waitForTimeout(1200);
  const dom = await domCount();
  const store = await storeCount();
  console.log(`1) 批量加到 ${TARGET}: 耗时 ${tAdd}ms | DOM=${dom} store=${store}`);
  check(dom === TARGET && store === TARGET, 'DOM 与 store 都应有 200 个节点');

  // 网格行数写死时，第 101 个之后的节点会全部堆回原点
  const layout = await p.evaluate(async () => {
    const m = await window.__intxMod('/src/app/stores/graphStore.ts');
    const pos = Object.values(m.useGraphStore.getState().nodes).map(
      (n) => `${Math.round(n.position.x)},${Math.round(n.position.y)}`,
    );
    const seen = new Map();
    for (const k of pos) seen.set(k, (seen.get(k) ?? 0) + 1);
    return {
      total: pos.length,
      unique: seen.size,
      duplicateCells: [...seen.values()].filter((v) => v > 1).length,
      maxStack: Math.max(...seen.values()),
    };
  });
  console.log(`   布局: ${layout.unique}/${layout.total} 个不同坐标, 重叠格=${layout.duplicateCells}, 最大堆叠=${layout.maxStack}`);
  check(layout.unique === TARGET && layout.maxStack === 1, '200 个节点必须各有独立坐标');

  // ── 2. 拖拽 ──
  const first = p.locator('.react-flow__node').first();
  const bb = await first.boundingBox();
  const before = await p.evaluate(async () => {
    const m = await window.__intxMod('/src/app/stores/graphStore.ts');
    const n = Object.values(m.useGraphStore.getState().nodes)[0];
    return { id: n.id, x: n.position.x, y: n.position.y };
  });
  const tDrag = Date.now();
  await p.mouse.move(bb.x + 60, bb.y + 18);
  await p.mouse.down();
  await p.mouse.move(bb.x + 190, bb.y + 108, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(400);
  const after = await p.evaluate(async (id) => {
    const m = await window.__intxMod('/src/app/stores/graphStore.ts');
    const n = m.useGraphStore.getState().nodes[id];
    return { x: n.position.x, y: n.position.y };
  }, before.id);
  const dx = Math.round(after.x - before.x);
  const dy = Math.round(after.y - before.y);
  console.log(`2) 拖拽: ${Date.now() - tDrag}ms | Δ=(${dx},${dy})`);
  check(dx !== 0 || dy !== 0, '200 节点下拖拽应生效');

  // ── 3. 缩放 + 平移 ──
  const vp = () => p.locator('.react-flow__viewport').getAttribute('style');
  const zoomOf = (s) => {
    const m = /scale\(([\d.]+)\)/.exec(s || '');
    return m ? Number(m[1]) : null;
  };
  const z0 = zoomOf(await vp());
  const tZoom = Date.now();
  await p.mouse.move(900, 450);
  await p.mouse.wheel(0, -600);
  await p.waitForTimeout(350);
  const z1 = zoomOf(await vp());
  await p.mouse.wheel(0, 600);
  await p.waitForTimeout(350);
  const z2 = zoomOf(await vp());
  // React Flow 滚轮缩放是乘性的（d3-zoom），同样 delta 的放大/缩小并不对称，
  // 只断言方向正确且始终落在 minZoom/maxZoom 内，不强求回到原值。
  const inRange = [z0, z1, z2].every((z) => z !== null && z >= 0.2 && z <= 2);
  console.log(`3) 缩放: ${Date.now() - tZoom}ms | zoom ${z0}→${z1}→${z2} | 放大=${z1 > z0} 缩小=${z2 < z1} 范围正常=${inRange}`);
  check(z1 > z0 && z2 < z1 && inRange, '缩放方向应正确且不越界');
  // 默认「区域选择」下左键拖空白是框选，测平移要先切到抓手（顺带验工具开关）
  await p.locator('.mode-switch button').nth(1).click();
  const vpBeforePan = await vp();
  const tPan = Date.now();
  await p.mouse.move(1000, 700);
  await p.mouse.down();
  await p.mouse.move(1120, 760, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(250);
  const panned = (await vp()) !== vpBeforePan;
  console.log(`   平移: ${Date.now() - tPan}ms | viewport变化=${panned}`);
  check(panned, '平移应改变 viewport');
  await p.locator('.mode-switch button').nth(0).click();

  // ── 4. 200 节点整图快照下的撤销 / 重做 ──
  const undoResult = await p.evaluate(async () => {
    const g = await window.__intxMod('/src/app/stores/graphStore.ts');
    const h = await window.__intxMod('/src/app/stores/historyStore.ts');
    const before = { past: h.useHistoryStore.getState().past.length };
    const t = performance.now();
    const ok = h.undo();
    const mid = {
      past: h.useHistoryStore.getState().past.length,
      future: h.useHistoryStore.getState().future.length,
    };
    h.redo();
    const after = { past: h.useHistoryStore.getState().past.length };
    return { ok, before, mid, after, ms: Math.round(performance.now() - t) };
  });
  console.log(`4) 撤销: ok=${undoResult.ok} past ${undoResult.before.past}→${undoResult.mid.past} future=${undoResult.mid.future} 重做后=${undoResult.after.past} | ${undoResult.ms}ms`);
  check(undoResult.ok && undoResult.mid.past === undoResult.before.past - 1, '撤销栈应正常回退');
  check(undoResult.after.past === undoResult.before.past, '重做应恢复历史深度');

  // ── 5. 自动保存 + 刷新恢复 ──
  await p.waitForTimeout(1600);
  console.log('5) 工具栏:', await p.locator('.toolbar').innerText().then((t) => t.replace(/\n/g, ' | ')));
  const tReload = Date.now();
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
  const reloaded = await domCount();
  console.log(`   刷新恢复: ${reloaded} 节点 / ${Date.now() - tReload}ms`);
  check(reloaded === TARGET, '刷新后应恢复全部 200 个节点');
  await p.screenshot({ path: OUTPUT_DIR + 'stress-200-detail.png' });
  await p.locator('.react-flow__controls-fitview').click();
  await p.waitForTimeout(700);
  await p.screenshot({ path: OUTPUT_DIR + 'stress-200.png' });

  finish('200 节点压力', errs);
  await b.close();
}
