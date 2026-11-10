import { create } from 'zustand';
import type { ProviderCapability, ProviderConfig, ProviderAdapter } from '@/domain';

/**
 * 厂商配置与产物的存储接口。
 *
 * 桌面端落在 Tauri 的 appDataDir 下（config.json + blobs/），
 * 浏览器调试回退到 localStorage + IndexedDB。
 * 上层只认这个接口 —— 这也是"只做桌面"这个决策下唯一需要保留的
 * 抽象点：它换来的是「不装桌面壳也能开发」。
 */
export interface ProviderStore {
  load(): Promise<ProviderConfig[]>;
  save(configs: readonly ProviderConfig[]): Promise<void>;
}

export interface BlobStore {
  /** 以内容哈希为键写入，已存在则直接跳过（天然去重）。 */
  put(key: string, bytes: ArrayBuffer, mime: string): Promise<void>;
  get(key: string): Promise<ArrayBuffer | null>;
  remove(key: string): Promise<void>;
  /** 是否已存在，用于去重统计 */
  has(key: string): Promise<boolean>;
}

export function defaultProviders(): ProviderConfig[] {
  return [
    {
      id: 'demo',
      name: '本地演示（无需 Key）',
      adapter: 'mock',
      baseUrl: '',
      apiKey: '',
      models: [
        { id: 'demo/image', label: '演示出图', capabilities: ['image'], aspectRatios: ['1:1', '16:9', '9:16'] },
        { id: 'demo/text', label: '演示文本', capabilities: ['text'] },
      ],
    },
  ];
}

/**
 * 适配器一侧的能力声明与节点需求之间的桥。
 *
 * 节点只说"我要出图"，具体用哪家、哪个模型由这里决定：
 * 优先用 preferred（用户上次选的），否则取第一个能干的。
 */
export function pickModel(
  configs: readonly ProviderConfig[],
  capability: ProviderCapability,
  preferred?: string,
): { config: ProviderConfig; modelId: string } | null {
  if (preferred) {
    for (const c of configs) {
      const m = c.models.find((x) => x.id === preferred && x.capabilities.includes(capability));
      if (m) return { config: c, modelId: m.id };
    }
  }
  for (const c of configs) {
    const m = c.models.find((x) => x.capabilities.includes(capability));
    if (m) return { config: c, modelId: m.id };
  }
  return null;
}

export interface ProviderState {
  configs: ProviderConfig[];
  loaded: boolean;
  store: ProviderStore | null;
  adapterFor: ((c: ProviderConfig) => ProviderAdapter) | null;
  setConfigs: (next: ProviderConfig[]) => void;
  setRuntime: (store: ProviderStore, adapterFor: (c: ProviderConfig) => ProviderAdapter) => void;
  upsert: (config: ProviderConfig) => void;
  remove: (id: string) => void;
}

export const useProviderStore = create<ProviderState>((set) => ({
  configs: [],
  loaded: false,
  store: null,
  adapterFor: null,
  setConfigs: (next) => set({ configs: next, loaded: true }),
  setRuntime: (store, adapterFor) => set({ store, adapterFor }),
  upsert: (config) =>
    set((s) => ({
      configs: s.configs.some((c) => c.id === config.id)
        ? s.configs.map((c) => (c.id === config.id ? config : c))
        : [...s.configs, config],
    })),
  remove: (id) => set((s) => ({ configs: s.configs.filter((c) => c.id !== id) })),
}));

/** 持久化当前配置。调用方不用关心落在哪。 */
export async function persistProviders(): Promise<void> {
  const { store, configs } = useProviderStore.getState();
  if (!store) return;
  await store.save(configs);
}
