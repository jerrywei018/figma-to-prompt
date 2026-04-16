import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensurePermission,
  isFsaSupported,
  pickDirectory,
  writeFileToDir,
  type FsaDirectoryHandle,
} from '../src/ui/folder';

function makeHandle(overrides: Partial<FsaDirectoryHandle> = {}): FsaDirectoryHandle {
  return {
    name: 'MyDir',
    getFileHandle: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn(),
    ...overrides,
  } as FsaDirectoryHandle;
}

describe('folder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('isFsaSupported / pickDirectory', () => {
    beforeEach(() => {
      // Node has no `window`; stub one so `typeof window !== 'undefined'` is true.
      vi.stubGlobal('window', {});
    });

    it('reports unsupported when showDirectoryPicker is missing', () => {
      expect(isFsaSupported()).toBe(false);
    });

    it('reports supported when showDirectoryPicker is a function', () => {
      (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = () => Promise.resolve();
      expect(isFsaSupported()).toBe(true);
    });

    it('pickDirectory returns null when unsupported', async () => {
      expect(await pickDirectory()).toBeNull();
    });

    it('pickDirectory returns the handle from showDirectoryPicker', async () => {
      const handle = makeHandle();
      (window as unknown as { showDirectoryPicker: (o?: unknown) => Promise<FsaDirectoryHandle> }).showDirectoryPicker = vi
        .fn()
        .mockResolvedValue(handle);
      expect(await pickDirectory()).toBe(handle);
    });

    it('pickDirectory returns null when the user cancels (AbortError)', async () => {
      (window as unknown as { showDirectoryPicker: () => Promise<FsaDirectoryHandle> }).showDirectoryPicker = vi
        .fn()
        .mockRejectedValue(new DOMException('cancelled', 'AbortError'));
      expect(await pickDirectory()).toBeNull();
    });
  });

  describe('ensurePermission', () => {
    it('returns true immediately when queryPermission is already granted', async () => {
      const handle = makeHandle({
        queryPermission: vi.fn().mockResolvedValue('granted'),
        requestPermission: vi.fn().mockResolvedValue('denied'),
      });
      expect(await ensurePermission(handle)).toBe(true);
      expect(handle.requestPermission).not.toHaveBeenCalled();
    });

    it('requests permission when query is not granted, returns true on grant', async () => {
      const request = vi.fn().mockResolvedValue('granted');
      const handle = makeHandle({
        queryPermission: vi.fn().mockResolvedValue('prompt'),
        requestPermission: request,
      });
      expect(await ensurePermission(handle)).toBe(true);
      expect(request).toHaveBeenCalledWith({ mode: 'readwrite' });
    });

    it('returns false when the user denies the permission request', async () => {
      const handle = makeHandle({
        queryPermission: vi.fn().mockResolvedValue('prompt'),
        requestPermission: vi.fn().mockResolvedValue('denied'),
      });
      expect(await ensurePermission(handle)).toBe(false);
    });

    it('returns false when a handle method throws', async () => {
      const handle = makeHandle({
        queryPermission: vi.fn().mockRejectedValue(new Error('boom')),
      });
      expect(await ensurePermission(handle)).toBe(false);
    });
  });

  describe('writeFileToDir', () => {
    it('creates the file, writes the blob, and closes the writable in order', async () => {
      const write = vi.fn().mockResolvedValue(undefined);
      const close = vi.fn().mockResolvedValue(undefined);
      const createWritable = vi.fn().mockResolvedValue({ write, close });
      const getFileHandle = vi.fn().mockResolvedValue({ createWritable });
      const handle = makeHandle({ getFileHandle });

      const blob = new Blob(['hi']);
      await writeFileToDir(handle, 'hello.png', blob);

      expect(getFileHandle).toHaveBeenCalledWith('hello.png', { create: true });
      expect(createWritable).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(blob);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('closes the writable even if write fails', async () => {
      const close = vi.fn().mockResolvedValue(undefined);
      const createWritable = vi.fn().mockResolvedValue({
        write: vi.fn().mockRejectedValue(new Error('disk full')),
        close,
      });
      const handle = makeHandle({ getFileHandle: vi.fn().mockResolvedValue({ createWritable }) });

      await expect(writeFileToDir(handle, 'a.png', new Blob())).rejects.toThrow('disk full');
      expect(close).toHaveBeenCalledTimes(1);
    });
  });
});
