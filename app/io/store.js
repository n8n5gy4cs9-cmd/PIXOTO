// Tiny IndexedDB key-value store for recent files and autosave recovery. Every call is best effort: storage can be
// blocked (private windows), so failures resolve quietly.
const DB = 'pixoto', STORES = ['recents', 'recovery'];
let dbp = null;
const open = () => (dbp ||= new Promise((res) => {
  try {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { for (const s of STORES) r.result.createObjectStore(s); };
    r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
  } catch { res(null); }
}));
const tx = async (store, mode, fn) => {
  const db = await open(); if (!db) return undefined;
  return new Promise((res) => { try { const t = db.transaction(store, mode), out = fn(t.objectStore(store)); t.oncomplete = () => res(out?.result); t.onerror = () => res(undefined); t.onabort = () => res(undefined); } catch { res(undefined); } });
};
export const put = (store, key, value) => tx(store, 'readwrite', (s) => s.put(value, key));
export const del = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));
export const get = (store, key) => tx(store, 'readonly', (s) => s.get(key));
export const all = async (store) => {
  const db = await open(); if (!db) return [];
  return new Promise((res) => { try { const out = [], c = db.transaction(store).objectStore(store).openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { out.push({ key: cur.key, value: cur.value }); cur.continue(); } else res(out); }; c.onerror = () => res([]); } catch { res([]); } });
};
export const clearStore = (store) => tx(store, 'readwrite', (s) => s.clear());

// ---- recent files (Composa: the last twelve opened or saved) ----
export async function addRecent(name, handle = null) {
  const list = (await all('recents')).map((r) => r.value).filter((r) => r.name !== name);
  list.unshift({ name, handle, time: Date.now() });
  await clearStore('recents');
  await Promise.all(list.slice(0, 12).map((r, i) => put('recents', String(i).padStart(2, '0'), r)));
}
export const getRecents = async () => (await all('recents')).sort((a, b) => (a.key < b.key ? -1 : 1)).map((r) => r.value);
export const clearRecents = () => clearStore('recents');

// ---- recovery ----
export const saveRecovery = (id, name, blob) => put('recovery', String(id), { name, blob, time: Date.now() });
export const dropRecovery = (id) => del('recovery', String(id));
export const listRecovery = async () => (await all('recovery')).map((r) => ({ id: r.key, ...r.value }));
