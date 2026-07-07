const INDEX_KEY = 'beasttv-projects';
const DATA_PREFIX = 'beasttv-project-';
const CURRENT_KEY = 'beasttv-current-project';
const OLD_STORAGE_KEY = 'beasttv-canvas';

function getIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeIndex(index) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (e) {
    console.warn('projectStorage: failed to write index', e);
  }
}

function getDataKey(id) {
  return DATA_PREFIX + id;
}

export function listProjects() {
  const projects = getIndex();
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  return projects;
}

export function createProject(name) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  const entry = { id, name, createdAt: now, updatedAt: now };

  const index = getIndex();
  index.push(entry);
  writeIndex(index);

  const data = { id, name, nodes: [], edges: [], nodeIdCounter: 1, nodeStates: {}, createdAt: now, updatedAt: now };
  localStorage.setItem(getDataKey(id), JSON.stringify(data));

  return id;
}

export function loadProject(id) {
  try {
    const raw = localStorage.getItem(getDataKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.nodes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveProject(id, data) {
  try {
    const now = Date.now();
    const payload = { ...data, id, updatedAt: now };
    localStorage.setItem(getDataKey(id), JSON.stringify(payload));

    const index = getIndex();
    const entry = index.find((p) => p.id === id);
    if (entry) {
      entry.updatedAt = now;
      writeIndex(index);
    }
    return true;
  } catch (e) {
    console.warn('projectStorage: failed to save', e);
    return false;
  }
}

export function deleteProject(id) {
  try {
    localStorage.removeItem(getDataKey(id));
    const index = getIndex().filter((p) => p.id !== id);
    writeIndex(index);
    return true;
  } catch {
    return false;
  }
}

export function renameProject(id, name) {
  const index = getIndex();
  const entry = index.find((p) => p.id === id);
  if (entry) {
    entry.name = name;
    writeIndex(index);
    return true;
  }
  return false;
}

export function setCurrentProjectId(id) {
  try {
    if (id) {
      localStorage.setItem(CURRENT_KEY, id);
    } else {
      localStorage.removeItem(CURRENT_KEY);
    }
  } catch {}
}

export function getCurrentProjectId() {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function migrateFromOldStorage() {
  try {
    const raw = localStorage.getItem(OLD_STORAGE_KEY);
    if (!raw) return false;

    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return false;

    const name = '未命名项目';
    const id = createProject(name);
    const data = loadProject(id);
    if (data) {
      data.nodes = parsed.nodes;
      data.edges = parsed.edges || [];
      data.nodeIdCounter = parsed.nodeIdCounter || 1;
      data.nodeStates = parsed.nodeStates || {};
      saveProject(id, data);
    }

    localStorage.removeItem(OLD_STORAGE_KEY);
    setCurrentProjectId(id);
    return true;
  } catch {
    return false;
  }
}
