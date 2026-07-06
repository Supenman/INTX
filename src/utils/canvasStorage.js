const STORAGE_KEY = 'beasttv-canvas';

/**
 * Save the current canvas state (nodes + edges) to localStorage.
 * Silently handles storage errors (quota exceeded, private browsing, etc.).
 */
export function saveCanvasState(state) {
  try {
    const payload = {
      nodes: state.nodes,
      edges: state.edges,
      nodeIdCounter: state.nodeIdCounter,
      nodeStates: state.nodeStates,
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch (e) {
    console.warn('canvasStorage: failed to save', e);
    return false;
  }
}

/**
 * Load a previously saved canvas state from localStorage.
 * Returns null when no saved state exists or the payload is corrupt.
 */
export function loadCanvasState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.nodes)) return null;
    return parsed;
  } catch (e) {
    console.warn('canvasStorage: failed to load', e);
    return null;
  }
}

/**
 * Permanently remove the saved canvas state.
 */
export function clearCanvasState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Debounced save — returns a save function that only writes
 * after `delay` ms of inactivity. Useful inside useEffect.
 */
export function createDebouncedSave(delay = 500) {
  let timer = null;
  return function debouncedSave(state) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      saveCanvasState(state);
      timer = null;
    }, delay);
  };
}
