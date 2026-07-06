const VIDEO_KEYS = ['veo', 'sora', 'wan2', 'wanx', 'doubao-seedance', 'doubao-1', 'kling', 'hailuo', 'video', 't2v-', 'i2v-', 's2v'];
const IMAGE_KEYS = ['image', 'dalle', 'dall-e', 'imagen', 'flux', 'stable', 'sdxl', 'midjourney', 'nano-banana', 'ideogram', 'fal-ai', 'z-image', 'qwen-image', 'klein'];

export const RESERVED_IDS = ['modelscope', 'runninghub', 'volcengine', 'jimeng', 'codex', 'comfly'];

export const PROTOCOLS = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'apimart', label: 'APIMart 异步' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'volcengine', label: '火山引擎' },
  { value: 'runninghub', label: 'RunningHub' },
  { value: 'jimeng', label: '即梦' },
  { value: 'codex', label: 'Codex' },
];

export const IMAGE_REQUEST_MODES = [
  { value: 'openai', label: 'openai (POST /v1/images/generations)' },
  { value: 'openai-json', label: 'openai-json (POST /v1/chat/completions — json mode)' },
];

export function classifyModel(id) {
  const lc = String(id || '').toLowerCase();
  if (VIDEO_KEYS.some(k => lc.includes(k))) return 'video';
  if (IMAGE_KEYS.some(k => lc.includes(k))) return 'image';
  return 'chat';
}

export function normalizeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

export function deriveIdFromName(name, existingId, allProviders) {
  if (RESERVED_IDS.includes(existingId)) return existingId;
  let id = normalizeId(name);
  if (!id) id = 'api-' + Math.random().toString(36).slice(2, 8);
  let candidate = id;
  let i = 2;
  while ((allProviders || []).some(p => p.id === candidate && p.id !== existingId)) {
    candidate = `${id}-${i++}`;
  }
  return candidate;
}

export function newProviderTemplate() {
  return {
    id: 'new-' + Date.now(),
    name: '新平台',
    base_url: '',
    protocol: 'openai',
    image_request_mode: 'openai',
    image_generation_endpoint: '',
    image_edit_endpoint: '',
    enabled: true,
    primary: false,
    image_models: [],
    chat_models: [],
    video_models: [],
    model_protocols: {},
    ms_loras: [],
    ms_defaults_version: 0,
    rh_apps: [],
    rh_workflows: [],
    volcengine_project_name: 'default',
    volcengine_region: 'cn-north-1',
    has_key: false,
    key_preview: '',
    key_env: '',
  };
}
