import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchProviders,
  saveProviders,
  testConnection,
  fetchUpstreamModels,
} from './apiClient.js';

const API = 'http://127.0.0.1:8000';

function mockJsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  };
}

describe('fetchProviders', () => {
  afterEach(() => vi.restoreAllMocks());

  it('GETs /api/providers and returns the providers list', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ providers: [{ id: 'a' }] })
    );
    const result = await fetchProviders();
    expect(fetchMock).toHaveBeenCalledWith(`${API}/api/providers`);
    expect(result).toEqual([{ id: 'a' }]);
  });

  it('returns [] when providers field is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse({}));
    expect(await fetchProviders()).toEqual([]);
  });
});

describe('saveProviders', () => {
  afterEach(() => vi.restoreAllMocks());

  it('PUTs to /api/providers and returns result', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ providers: [{ id: 'a' }] })
    );
    const providers = [{ id: 'a', name: 'A', base_url: 'https://a', protocol: 'openai' }];
    const result = await saveProviders(providers);
    expect(fetchMock).toHaveBeenCalledWith(`${API}/api/providers`, expect.objectContaining({ method: 'PUT' }));
    expect(result).toEqual({ providers: [{ id: 'a' }] });
  });

  it('throws on non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse('boom', { ok: false, status: 500 })
    );
    await expect(saveProviders([])).rejects.toThrow();
  });
});

describe('testConnection', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs provider credentials to /test-connection', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ ok: true, model_count: 3 })
    );
    const result = await testConnection({
      id: 'a', base_url: 'https://a', _api_key: 'k',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/api/providers/test-connection`);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ base_url: 'https://a', api_key: 'k', provider_id: 'a', protocol: 'openai', image_request_mode: 'openai' });
    expect(result.ok).toBe(true);
  });

  it('uses empty string when _api_key is missing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ ok: false })
    );
    await testConnection({ id: 'a', base_url: 'https://a' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.api_key).toBe('');
  });
});

describe('fetchUpstreamModels', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs to /fetch-models and returns parsed JSON', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ all: ['m1'], image_models: ['m1'], chat_models: [], video_models: [] })
    );
    const result = await fetchUpstreamModels({ id: 'a', base_url: 'https://a', protocol: 'openai', image_request_mode: 'openai' });
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/api/providers/fetch-models`);
    expect(result.all).toEqual(['m1']);
  });
});
