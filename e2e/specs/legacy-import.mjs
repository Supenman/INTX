import { openPage, finish, check } from '../helpers.mjs';

/**
 * S5：旧 localStorage → 预览报告 → 确认导入 → 刷新恢复。
 *
 * 重点不是"节点搬过来了"，而是**报告如实**：丢了几条连线、
 * 哪些字段没迁移、旧产物有没有被假装成资产，都要在 UI 上看得见。
 */
export async function run() {
  const { browser: b, page: p, errors: errs } = await openPage();

  const legacy = {
    nodes: [
      { id: 't1', type: 'text', position: { x: 80, y: 80 }, data: { prompt: '一只戴墨镜的橘猫', model: 'gpt-4o' } },
      { id: 'i1', type: 'image', position: { x: 480, y: 80 }, data: { prompt: '', result: 'https://tmp/old.png' } },
      { id: 'u1', type: 'future-node', position: { x: 80, y: 420 }, data: { mystery: 42 } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'i1' },
      { id: 'e2', source: 'u1', target: 't1' },
    ],
    nodeIdCounter: 4,
    nodeStates: { i1: { status: 'done' } },
    savedAt: 1_700_000_000_000,
  };
  const project = { ...legacy, nodes: [legacy.nodes[0]], edges: [], name: '旧分镜' };

  await p.evaluate(
    ({ canvas, proj }) => {
      localStorage.setItem('beasttv-canvas', JSON.stringify(canvas));
      localStorage.setItem('beasttv-projects', JSON.stringify([{ id: 'p1', name: '旧分镜', updatedAt: 1_700_000_000_000 }]));
      localStorage.setItem('beasttv-project-p1', JSON.stringify(proj));
    },
    { canvas: legacy, proj: project },
  );
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  // ── 1. 扫描出两类来源 ──
  await p.getByRole('button', { name: '导入旧版数据' }).click();
  await p.waitForTimeout(300);
  const sources = await p.locator('.legacy-source').count();
  console.log('1) 扫到的旧数据来源:', sources);
  check(sources === 2, '应扫到单画布与项目两个来源');

  // ── 2. 预览报告如实说明迁移结果 ──
  const stats = (await p.locator('.legacy-stats span').allInnerTexts()).join(' | ');
  console.log('2) 预览统计:', stats);
  check(stats.includes('节点 3'), '预览应显示 3 个节点');
  check(stats.includes('连线 1'), '预览应显示 1 条可迁移连线');
  check(stats.includes('占位 1'), '未识别类型应落成 1 个占位节点');
  check(stats.includes('丢弃连线 1'), '指向文字输入的连线应被丢弃');

  const notes = (await p.locator('.legacy-note').allInnerTexts()).join('\n');
  check(notes.includes('一律不迁移'), '报告必须说明旧产物不迁移');
  check(notes.includes('nodeStates'), '报告必须说明运行状态不迁移');
  check(notes.includes('无法识别'), '报告必须说明未识别类型');
  check(!notes.includes('gpt-4o'), '旧模型名不该被当成新配置悄悄带进来');

  const fields = await p.locator('.legacy-fields').innerText();
  console.log('   未迁移字段:', fields.replace(/\n/g, ' '));
  check(fields.includes('model') && fields.includes('result'), '未迁移字段应列出 model 与 result');

  const reasons = await p.locator('.legacy-reasons').innerText();
  check(reasons.includes('没有可用的输入口'), '丢弃连线要给出具体原因');

  // ── 3. 确认导入（confirm 由 helpers 自动接受）──
  await p.locator('.legacy-apply').click();
  await p.waitForTimeout(900);
  const nodeCount = await p.locator('.react-flow__node').count();
  const edgeCount = await p.locator('.react-flow__edge').count();
  console.log('3) 导入后:', nodeCount, '节点 /', edgeCount, '连线');
  check(nodeCount === 3, '导入后应有 3 个节点');
  check(edgeCount === 1, '导入后应有 1 条连线');

  const nodeTexts = await p.locator('.react-flow__node').allInnerTexts();
  const areaValues = await p.locator('.react-flow__node textarea').evaluateAll((els) => els.map((e) => e.value));
  const allText = [...nodeTexts, ...areaValues].join('\n');
  check(allText.includes('一只戴墨镜的橘猫'), '旧文本节点的提示词应保留');
  check(allText.includes('future-node') && allText.includes('mystery'), '未识别节点应保留原始内容快照');
  check(!allText.includes('https://tmp/old.png'), '旧产物 URL 不该被当成资产塞进画布');

  // ── 4. 扫描只读 ──
  const stillThere = await p.evaluate(() => localStorage.getItem('beasttv-canvas') !== null);
  console.log('4) 旧 key 仍在:', stillThere);
  check(stillThere, '扫描应是只读的，不能删除旧 localStorage 数据');

  // ── 5. 刷新恢复 ──
  await p.waitForTimeout(1200);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const afterReload = await p.locator('.react-flow__node').count();
  console.log('5) 刷新后节点数:', afterReload);
  check(afterReload === 3, '导入结果应随项目自动保存并恢复');

  await b.close();
  finish('旧版数据迁移', errs);
}
