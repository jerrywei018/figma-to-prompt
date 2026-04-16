/**
 * Minimal IndexedDB wrapper for persisting a single `FileSystemDirectoryHandle`
 * across plugin sessions. Handles are not JSON-serializable, so `figma.clientStorage`
 * can't hold them — IDB's structured clone is the only web-standard option.
 *
 * Every function swallows errors and resolves to a safe default (null / void).
 * Callers treat "not supported" and "failed" the same way: fall back to
 * `<a download>` via `download.ts`.
 */

const DB_NAME = 'figma-to-prompt';
const STORE_NAME = 'prefs';
const DB_VERSION = 1;
const KEY = 'downloadDir';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!idb) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Wait for a transaction to fully commit (`oncomplete`), not just the request callback. */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Generic over the handle type so callers can use their own narrow interface
 * (e.g. `FsaDirectoryHandle` from `folder.ts`) without a DOM-lib dependency.
 * IndexedDB's structured clone roundtrips the actual handle instance regardless.
 */
export async function saveDirHandle<T>(handle: T): Promise<void> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, KEY);
      await txDone(tx);
    } finally {
      db.close();
    }
  } catch {
    // Swallow — UI treats failure same as unsupported.
  }
}

export async function loadDirHandle<T>(): Promise<T | null> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY);
      await txDone(tx);
      return (req.result as T | undefined) ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function clearDirHandle(): Promise<void> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(KEY);
      await txDone(tx);
    } finally {
      db.close();
    }
  } catch {
    // Swallow.
  }
}
