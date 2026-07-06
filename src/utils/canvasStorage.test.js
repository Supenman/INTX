import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  saveCanvasState,
  loadCanvasState,
  clearCanvasState,
  createDebouncedSave,
} from './canvasStorage';

const STORAGE_KEY = 'beasttv-canvas';

/** Minimal fake localStorage for Node environment */
function fakeLocalStorage() {
  const store = {};
  const mock = {
    getItem: (key) => store[key] ?? null,
    setItem: (key, val) => { store[key] = val; },
    removeItem: (key) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  };
  vi.stubGlobal('localStorage', mock);
  return store;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const SAMPLE_STATE = {
  nodes: [
    { id: '1', type: 'image', position: { x: 100, y: 100 }, data: { prompt: '' } },
    { id: '2', type: 'text', position: { x: 300, y: 200 }, data: { prompt: 'hello' } },
  ],
  edges: [
    { id: 'e-1-2', source: '1', target: '2' },
  ],
  nodeIdCounter: 3,
  nodeStates: {},
};

describe('saveCanvasState', () => {
  it('writes serialized state to localStorage', () => {
    const store = fakeLocalStorage();
    const result = saveCanvasState(SAMPLE_STATE);
    expect(result).toBe(true);
    expect(STORAGE_KEY in store).toBe(true);
    const parsed = JSON.parse(store[STORAGE_KEY]);
    expect(parsed.nodes).toEqual(SAMPLE_STATE.nodes);
    expect(parsed.edges).toEqual(SAMPLE_STATE.edges);
    expect(parsed.nodeIdCounter).toBe(3);
    expect(parsed.nodeStates).toEqual({});
    expect(parsed.savedAt).toBeTypeOf('number');
  });

  it('returns false when localStorage.setItem throws', () => {
    fakeLocalStorage();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(saveCanvasState(SAMPLE_STATE)).toBe(false);
  });

  it('only saves expected fields (no extra cruft)', () => {
    const store = fakeLocalStorage();
    saveCanvasState({ ...SAMPLE_STATE, somethingExtra: 'nope' });
    const parsed = JSON.parse(store[STORAGE_KEY]);
    expect(parsed.somethingExtra).toBeUndefined();
    expect(parsed.nodes).toBeDefined();
  });
});

describe('loadCanvasState', () => {
  it('returns parsed state when storage has data', () => {
    const store = fakeLocalStorage();
    store[STORAGE_KEY] = JSON.stringify(SAMPLE_STATE);
    const loaded = loadCanvasState();
    expect(loaded.nodes).toEqual(SAMPLE_STATE.nodes);
    expect(loaded.edges).toEqual(SAMPLE_STATE.edges);
    expect(loaded.nodeIdCounter).toBe(3);
  });

  it('returns null when storage is empty', () => {
    fakeLocalStorage();
    expect(loadCanvasState()).toBeNull();
  });

  it('returns null when payload is corrupt JSON', () => {
    const store = fakeLocalStorage();
    store[STORAGE_KEY] = 'not-json';
    expect(loadCanvasState()).toBeNull();
  });

  it('returns null when nodes field is not an array', () => {
    const store = fakeLocalStorage();
    store[STORAGE_KEY] = JSON.stringify({ nodes: null, edges: [] });
    expect(loadCanvasState()).toBeNull();
  });

  it('handles localStorage.getItem throwing', () => {
    fakeLocalStorage();
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    expect(loadCanvasState()).toBeNull();
  });
});

describe('clearCanvasState', () => {
  it('removes the key from storage', () => {
    const store = fakeLocalStorage();
    store[STORAGE_KEY] = 'x';
    clearCanvasState();
    expect(store[STORAGE_KEY]).toBeUndefined();
  });

  it('returns false on error', () => {
    fakeLocalStorage();
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(clearCanvasState()).toBe(false);
  });
});

describe('createDebouncedSave', () => {
  it('calls saveCanvasState after the delay', () => {
    fakeLocalStorage();
    const debounced = createDebouncedSave(200);
    debounced(SAMPLE_STATE);

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    vi.advanceTimersByTime(200);

    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(parsed.nodeIdCounter).toBe(3);
  });

  it('debounces multiple rapid calls - only last one writes', () => {
    const store = fakeLocalStorage();
    const debounced = createDebouncedSave(200);
    debounced(SAMPLE_STATE);
    debounced({ ...SAMPLE_STATE, nodeIdCounter: 99 });
    debounced({ ...SAMPLE_STATE, nodeIdCounter: 100 });

    vi.advanceTimersByTime(200);

    const parsed = JSON.parse(store[STORAGE_KEY]);
    expect(parsed.nodeIdCounter).toBe(100);
  });
});
