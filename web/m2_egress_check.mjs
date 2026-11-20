/**
 * M2 收尾验收：出网方式（C1-C4）+ 台账敏感性。
 *
 * 不发真实厂商请求：所有发往 ModelScope 或本地代理的请求一律被拦截，
 * 直接回 401。只观察「请求实际发往哪个 URL」，以及本机台账写了什么。
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3000';
const FAKE_KEY = 'TEST-KEY-DO-NOT-USE';
const MS_BASE = 'https://api-inference.modelscope.cn/v1';
const PROXY = 'http://127.0.0.1:23210';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

const seen = [];
await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('127.0.0.1:23210') || url.includes('api-inference.modelscope.cn')) {
        seen.push({ url, method: route.request().method(), via: url.startsWith(PROXY) ? 'proxy' : 'direct' });
        await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'invalid api key (intercepted)' } }),
        });
        return;
    }
    await route.continue();
});

await page.goto(`${BASE}/config`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

async function readLedger() {
    return page.evaluate(() => new Promise((resolve, reject) => {
        const req = indexedDB.open('infinite-canvas');
        req.onerror = () => reject('open');
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('app_state')) { db.close(); resolve({}); return; }
            const tx = db.transaction('app_state', 'readonly');
            const store = tx.objectStore('app_state');
            const out = {};
            const cur = store.openCursor();
            cur.onsuccess = () => {
                const c = cur.result;
                if (c) {
                    out[c.key] = typeof c.value === 'string' ? c.value : JSON.stringify(c.value);
                    c.continue();
                }
            };
            tx.oncomplete = () => { db.close(); resolve(out); };
            tx.onerror = () => reject('read');
        };
    }));
}

async function runCase(label, { proxyMode, proxyEnabled, expect }) {
    seen.length = 0;
    const result = await page.evaluate(async ({ proxyMode, proxyEnabled, fakeKey, msBase, proxy }) => {
        const { useConfigStore } = await import('/src/stores/use-config-store.ts');
        const { requestSingleImage } = await import('/src/services/api/image.ts');
        const state = useConfigStore.getState();
        const channel = {
            ...state.config.channels[0],
            id: 'default',
            baseUrl: msBase,
            apiKey: fakeKey,
            apiFormat: 'openai',
            models: ['ms-test-model'],
            ...(proxyMode === undefined ? {} : { proxyMode }),
        };
        if (proxyMode === undefined) delete channel.proxyMode;
        useConfigStore.setState({
            config: {
                ...state.config,
                baseUrl: msBase,
                apiKey: fakeKey,
                model: 'ms-test-model',
                imageModel: 'ms-test-model',
                channels: [channel],
                proxyEnabled,
                proxyUrl: proxy,
            },
        });
        const cfg = useConfigStore.getState().config;
        try {
            await requestSingleImage(cfg, 'm2 egress check');
            return { threw: false };
        } catch (e) {
            return { threw: true, code: e?.code ?? e?.name ?? 'unknown', message: String(e?.message ?? e).slice(0, 160) };
        }
    }, { proxyMode, proxyEnabled, fakeKey: FAKE_KEY, msBase: MS_BASE, proxy: PROXY });

    const via = seen.length ? seen[0].via : 'none';
    const ok = via === expect;
    const ledger = await readLedger();
    const ledgerText = Object.values(ledger).join('\n');
    const leaks = [FAKE_KEY, 'api-inference.modelscope.cn', 'data:image'].filter((s) => ledgerText.includes(s));
    const logText = ledger['infinite-canvas:intx_task_log'] ?? '';
    let taskCount = 0;
    try { taskCount = Object.keys(JSON.parse(logText).state ?? logText).length; } catch { taskCount = -1; }
    console.log(JSON.stringify({ label, expect, via, ok, requests: seen, result, ledgerKeys: Object.keys(ledger), logBytes: logText.length, taskCount, leaks }));
}

await runCase('C1 system + 代理开', { proxyMode: 'system', proxyEnabled: true, expect: 'proxy' });
await runCase('C2 direct + 代理开', { proxyMode: 'direct', proxyEnabled: true, expect: 'direct' });
await runCase('C3 system + 代理关', { proxyMode: 'system', proxyEnabled: false, expect: 'direct' });
await runCase('C4 老配置(无字段) + 代理开', { proxyMode: undefined, proxyEnabled: true, expect: 'proxy' });

console.log('PAGE_ERRORS:', pageErrors.length, pageErrors.slice(0, 3));
await browser.close();
