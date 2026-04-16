/**
 * File System Access API abstraction. Kept DOM-agnostic-ish (declares only the
 * narrow subset we use) so tests can mock without dragging in jsdom.
 *
 * Every entry point fails soft: unsupported browser, user cancel, permission
 * denial, and thrown errors all resolve to `null` / `false` rather than throwing.
 * Callers treat every "not now" case identically (fall back to `<a download>`).
 */

type FsaPermissionMode = 'read' | 'readwrite';
type FsaPermissionState = 'granted' | 'denied' | 'prompt';

export interface FsaDirectoryHandle {
  readonly name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsaFileHandle>;
  queryPermission(desc: { mode: FsaPermissionMode }): Promise<FsaPermissionState>;
  requestPermission(desc: { mode: FsaPermissionMode }): Promise<FsaPermissionState>;
}

interface FsaFileHandle {
  createWritable(): Promise<FsaWritable>;
}

interface FsaWritable {
  write(data: BlobPart): Promise<void>;
  close(): Promise<void>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: FsaPermissionMode }) => Promise<FsaDirectoryHandle>;
  }
}

export function isFsaSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/** Opens the native directory picker. Returns null on cancel or any failure. */
export async function pickDirectory(): Promise<FsaDirectoryHandle | null> {
  if (!isFsaSupported() || !window.showDirectoryPicker) return null;
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    // AbortError (user cancel), SecurityError (sandbox), etc.
    return null;
  }
}

/**
 * Ensure we can write to `handle`. If the persisted handle's permission lapsed
 * (common after reload), this triggers a prompt — hence it MUST be called from
 * within a user gesture (e.g., the download button click handler).
 */
export async function ensurePermission(handle: FsaDirectoryHandle): Promise<boolean> {
  try {
    const current = await handle.queryPermission({ mode: 'readwrite' });
    if (current === 'granted') return true;
    const result = await handle.requestPermission({ mode: 'readwrite' });
    return result === 'granted';
  } catch {
    return false;
  }
}

/** Writes `blob` as `filename` inside `dir`, overwriting if it exists. Throws on failure — callers decide fallback strategy. */
export async function writeFileToDir(
  dir: FsaDirectoryHandle,
  filename: string,
  blob: Blob,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}
