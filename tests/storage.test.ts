import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDirHandle, loadDirHandle, saveDirHandle } from '../src/ui/storage';

/**
 * Minimal in-memory IndexedDB stub. Covers just enough of the spec surface for
 * storage.ts: open → createObjectStore on upgrade, transaction → objectStore →
 * get/put/delete, onsuccess/oncomplete fired asynchronously (via queueMicrotask
 * so `await` resolves in deterministic order).
 *
 * Not a full IDB polyfill — we only mock what we use. Adding `fake-indexeddb`
 * would be overkill for 3 functions with no query/index complexity.
 */
function makeFakeIndexedDB() {
  const stores = new Map<string, Map<string, unknown>>();
  let failNextOpen = false;
  let failNextTx = false;

  function tick(cb: () => void) {
    queueMicrotask(cb);
  }

  function idbRequest<T>(resolver: () => T): { result: T | undefined; error: Error | null; onsuccess: ((e: unknown) => void) | null; onerror: ((e: unknown) => void) | null } {
    const req: {
      result: T | undefined;
      error: Error | null;
      onsuccess: ((e: unknown) => void) | null;
      onerror: ((e: unknown) => void) | null;
    } = { result: undefined, error: null, onsuccess: null, onerror: null };
    tick(() => {
      try {
        req.result = resolver();
        req.onsuccess?.({ target: req });
      } catch (e) {
        req.error = e as Error;
        req.onerror?.({ target: req });
      }
    });
    return req;
  }

  const fake = {
    open(_name: string, _version: number) {
      const wasNew = !stores.has('prefs');
      const req: {
        result: unknown;
        error: Error | null;
        onsuccess: ((e: unknown) => void) | null;
        onerror: ((e: unknown) => void) | null;
        onupgradeneeded: ((e: unknown) => void) | null;
      } = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };

      if (failNextOpen) {
        failNextOpen = false;
        tick(() => {
          req.error = new Error('open failed');
          req.onerror?.({ target: req });
        });
        return req;
      }

      const db = {
        objectStoreNames: { contains: (n: string) => stores.has(n) },
        createObjectStore(n: string) {
          stores.set(n, new Map());
          return {};
        },
        transaction(storeName: string, _mode: string) {
          if (failNextTx) {
            failNextTx = false;
            const tx: { oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null; error: Error; objectStore: (n: string) => unknown } = {
              oncomplete: null,
              onerror: null,
              onabort: null,
              error: new Error('tx failed'),
              objectStore: () => ({
                get: () => idbRequest(() => undefined),
                put: () => idbRequest(() => undefined),
                delete: () => idbRequest(() => undefined),
              }),
            };
            tick(() => tx.onerror?.());
            return tx;
          }
          const store = stores.get(storeName);
          if (!store) throw new Error(`no store ${storeName}`);
          const tx: { oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null; objectStore: (n: string) => unknown } = {
            oncomplete: null,
            onerror: null,
            onabort: null,
            objectStore: () => ({
              get: (k: string) => idbRequest(() => store.get(k)),
              put: (v: unknown, k: string) => idbRequest(() => {
                store.set(k, v);
                return undefined;
              }),
              delete: (k: string) => idbRequest(() => {
                store.delete(k);
                return undefined;
              }),
            }),
          };
          tick(() => tx.oncomplete?.());
          return tx;
        },
        close() {},
      };
      req.result = db;
      tick(() => {
        if (wasNew) req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };

  return {
    idb: fake,
    reset() {
      stores.clear();
      failNextOpen = false;
      failNextTx = false;
    },
    peek(key: string) {
      return stores.get('prefs')?.get(key);
    },
    triggerOpenFailure() {
      failNextOpen = true;
    },
    triggerTxFailure() {
      failNextTx = true;
    },
  };
}

describe('storage', () => {
  let fake: ReturnType<typeof makeFakeIndexedDB>;

  beforeEach(() => {
    fake = makeFakeIndexedDB();
    vi.stubGlobal('indexedDB', fake.idb);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('save → load round-trips the same handle reference', async () => {
    const handle = { name: 'MyFolder' } as unknown as FileSystemDirectoryHandle;
    await saveDirHandle(handle);
    const loaded = await loadDirHandle();
    expect(loaded).toBe(handle);
  });

  it('loadDirHandle returns null when nothing has been stored', async () => {
    const loaded = await loadDirHandle();
    expect(loaded).toBeNull();
  });

  it('clearDirHandle removes the stored entry', async () => {
    const handle = { name: 'X' } as unknown as FileSystemDirectoryHandle;
    await saveDirHandle(handle);
    await clearDirHandle();
    expect(await loadDirHandle()).toBeNull();
  });

  it('swallows errors from saveDirHandle', async () => {
    fake.triggerOpenFailure();
    await expect(saveDirHandle({ name: 'x' } as unknown as FileSystemDirectoryHandle)).resolves.toBeUndefined();
  });

  it('loadDirHandle returns null when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(await loadDirHandle()).toBeNull();
  });
});
