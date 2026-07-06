const API_BASE = '';

async function asJson(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `请求失败: ${res.status}`);
  }
  return res.json();
}

export async function fetchProviders() {
  const res = await fetch(`${API_BASE}/api/providers`);
  const data = await asJson(res);
  return data.providers || [];
}

export async function saveProviders(providers) {
  const payload = providers.map(p => ({
    id: p.id,
    name: p.name,
    base_url: p.base_url,
    protocol: p.protocol,
    image_request_mode: p.image_request_mode || 'openai',
    image_generation_endpoint: p.image_generation_endpoint || '',
    image_edit_endpoint: p.image_edit_endpoint || '',
    enabled: p.enabled ?? true,
    primary: !!p.primary,
    image_models: p.image_models || [],
    chat_models: p.chat_models || [],
    video_models: p.video_models || [],
    model_protocols: p.model_protocols || {},
    ms_loras: p.ms_loras || [],
    ms_defaults_version: p.ms_defaults_version || 0,
    rh_apps: p.rh_apps || [],
    rh_workflows: p.rh_workflows || [],
    volcengine_project_name: p.volcengine_project_name || 'default',
    volcengine_region: p.volcengine_region || 'cn-north-1',
    volcengine_access_key_id: p._volcengine_access_key || null,
    volcengine_secret_access_key: p._volcengine_secret_key || null,
    api_key: p._api_key || null,
    wallet_api_key: p._wallet_api_key || null,
    clear_key: !!p._clear_key,
    clear_wallet_key: !!p._clear_wallet_key,
    clear_volcengine_access_key_id: !!p._clear_volcengine_access_key,
    clear_volcengine_secret_access_key: !!p._clear_volcengine_secret_key,
  }));
  const res = await fetch(`${API_BASE}/api/providers`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return asJson(res);
}

export async function testConnection(provider) {
  const res = await fetch(`${API_BASE}/api/providers/test-connection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_url: provider.base_url,
      api_key: provider._api_key || '',
      provider_id: provider.id,
      protocol: provider.protocol || 'openai',
      image_request_mode: provider.image_request_mode || 'openai',
    }),
  });
  return asJson(res);
}

export async function fetchUpstreamModels(provider) {
  const res = await fetch(`${API_BASE}/api/providers/fetch-models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_url: provider.base_url,
      api_key: provider._api_key || '',
      provider_id: provider.id,
      protocol: provider.protocol || 'openai',
      image_request_mode: provider.image_request_mode || 'openai',
    }),
  });
  return asJson(res);
}

export async function createTask(payload) {
  const res = await fetch(`${API_BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return asJson(res);
}

export async function getTaskStatus(taskId) {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}`);
  return asJson(res);
}
