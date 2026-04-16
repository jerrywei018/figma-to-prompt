import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Action, State } from '../state';
import type { ExportMode, ImageFormat } from '../../shared/types';
import { type ImageAsset, collectImageAssets, sanitizeFileName } from '../prompt';
import { mergedExt, perImageExt, useDebouncedCallback, useFeedback } from '../utils';
import { createZip, dataUrlToBlob, downloadBlob } from '../download';
import {
  type FsaDirectoryHandle,
  ensurePermission,
  isFsaSupported,
  pickDirectory,
  writeFileToDir,
} from '../folder';
import { loadDirHandle, saveDirHandle } from '../storage';
import { ButtonGroup } from './ButtonGroup';

interface Props {
  state: State;
  dispatch: (action: Action) => void;
}

const MODE_OPTIONS = [
  { value: 'per-image' as ExportMode, label: 'Each image' },
  { value: 'merged' as ExportMode, label: 'Whole frame' },
];

const FORMAT_OPTIONS: { value: ImageFormat; label: string }[] = [
  { value: 'PNG', label: 'PNG' },
  { value: 'JPG', label: 'JPG' },
  { value: 'SVG', label: 'SVG' },
];

const SCALE_OPTIONS = [
  { value: '0', label: 'Orig' },
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
  { value: '3', label: '3×' },
  { value: '4', label: '4×' },
];

// Per-keystroke prompt rebuild walks the entire node tree via buildPrompt;
// 80ms collapses bursts without lagging the input.
const NAME_DEBOUNCE_MS = 80;

// ── PreviewArea ─────────────────────────────────────────
function PreviewArea({ state, assets }: { state: State; assets: ImageAsset[] }) {
  if (!state.data) {
    return (
      <div class="preview-area" aria-live="polite">
        <div class="preview-placeholder">Waiting for selection…</div>
      </div>
    );
  }

  const loadedCount = state.mergedImage ? 1 : Object.keys(state.images).length;
  const willExport = state.mode === 'merged' || assets.length > 0;
  const stillLoading = willExport && loadedCount === 0;

  if (stillLoading) {
    return (
      <div class="preview-area" aria-live="polite">
        <div class="preview-loading">Generating preview…</div>
      </div>
    );
  }

  if (state.mode === 'merged') {
    return (
      <div class="preview-area preview-area--merged" aria-live="polite">
        {state.mergedImage ? (
          <img class="preview-merged" src={state.mergedImage} alt={`Merged preview of ${state.data.name}`} />
        ) : (
          <div class="preview-placeholder">No preview available</div>
        )}
      </div>
    );
  }

  const thumbs = assets
    .map((a) => ({ asset: a, url: state.images[a.nodeId] }))
    .filter((t) => !!t.url);

  if (thumbs.length === 0) {
    return (
      <div class="preview-area preview-area--strip" aria-live="polite">
        <div class="preview-placeholder">No images to export</div>
      </div>
    );
  }

  // `preview-area--strip` lets CSS collapse this block when the rename panel
  // is open (the inline thumbs in each row take over as the per-image map).
  return (
    <div class="preview-area preview-area--strip" aria-live="polite">
      <div class="preview-strip">
        {thumbs.map((t) => (
          <img
            key={t.asset.nodeId}
            class="preview-thumb"
            src={t.url}
            alt={t.asset.nodeName}
            title={t.asset.nodeName}
          />
        ))}
      </div>
    </div>
  );
}

// ── NameRow ─────────────────────────────────────────────
interface NameRowProps {
  label: string;
  placeholder: string;
  initialValue: string;
  ext: string;
  /** Inline thumbnail — when present, replaces the text label as the primary
   *  identifier so users can tell at a glance which image they're renaming. */
  thumbUrl?: string;
  onCommit: (value: string) => void;
}

/** Uncontrolled input — keystrokes only fire the debounced commit, so the
 *  reducer (which rebuilds the whole prompt) doesn't run per keystroke. */
function NameRow({ label, placeholder, initialValue, ext, thumbUrl, onCommit }: NameRowProps) {
  const debouncedCommit = useDebouncedCallback(onCommit, NAME_DEBOUNCE_MS);

  function handleInput(e: JSX.TargetedEvent<HTMLInputElement>) {
    const sanitized = sanitizeFileName(e.currentTarget.value);
    if (sanitized !== e.currentTarget.value) e.currentTarget.value = sanitized;
    debouncedCommit(sanitized);
  }

  function handleReset(e: JSX.TargetedMouseEvent<HTMLButtonElement>) {
    const input = e.currentTarget.parentElement?.querySelector<HTMLInputElement>('.name-input');
    if (input) input.value = '';
    onCommit(''); // commit immediately on reset — no point debouncing a click
  }

  return (
    <div class="name-row">
      {thumbUrl ? (
        <img class="name-row-thumb" src={thumbUrl} alt={label} title={label} />
      ) : (
        <span class="name-row-label" title={label}>
          {label}
        </span>
      )}
      <span class="name-input-wrap">
        <input
          type="text"
          class="name-input"
          placeholder={placeholder}
          defaultValue={initialValue}
          spellcheck={false}
          onInput={handleInput}
        />
        <button
          type="button"
          class="name-reset"
          title="Reset to default"
          aria-label="Reset to default name"
          onClick={handleReset}
        >
          ×
        </button>
      </span>
      <span class="name-ext">.{ext}</span>
    </div>
  );
}

// ── RenamesList ─────────────────────────────────────────
function RenamesList({ state, assets, dispatch }: { state: State; assets: ImageAsset[]; dispatch: Props['dispatch'] }) {
  if (!state.data) return null;

  if (state.mode === 'merged') {
    return (
      <NameRow
        label="Whole frame"
        placeholder={sanitizeFileName(state.data.name)}
        initialValue={state.mergedImageName}
        ext={mergedExt(state.format)}
        onCommit={(v) => dispatch({ type: 'MERGED_NAME_CHANGED', value: v })}
      />
    );
  }

  const ext = perImageExt(state.scale, state.format);
  return (
    <>
      {assets.map((a) => (
        <NameRow
          key={a.nodeId}
          label={a.nodeName}
          placeholder={a.fileName.replace(/\.png$/, '')}
          initialValue={state.nameOverrides[a.nodeId] ?? ''}
          ext={ext}
          thumbUrl={state.images[a.nodeId]}
          onCommit={(v) => dispatch({ type: 'NAME_OVERRIDE_CHANGED', id: a.nodeId, value: v })}
        />
      ))}
    </>
  );
}

// ── FolderPickerRow ─────────────────────────────────────
/**
 * Shows the remembered download folder (or a "choose" prompt if none), with a
 * link-styled button to open the native picker. Only renders when the File
 * System Access API is available — otherwise the whole row is hidden and the
 * DownloadButton silently falls back to `<a download>`.
 */
interface FolderPickerRowProps {
  dir: FsaDirectoryHandle | null;
  onPick: () => void;
}

function FolderPickerRow({ dir, onPick }: FolderPickerRowProps) {
  return (
    <div class="folder-picker-row">
      <span class="folder-picker-icon" aria-hidden="true">📁</span>
      {dir ? (
        <>
          <span class="folder-picker-name" title={dir.name}>
            {dir.name}
          </span>
          <button type="button" class="folder-picker-change" onClick={onPick}>
            Change
          </button>
        </>
      ) : (
        <button type="button" class="folder-picker-change" onClick={onPick}>
          Choose download folder…
        </button>
      )}
    </div>
  );
}

// ── DownloadButton ──────────────────────────────────────
interface DownloadButtonProps {
  state: State;
  dirHandle: FsaDirectoryHandle | null;
  fsaSupported: boolean;
}

function DownloadButton({ state, dirHandle, fsaSupported }: DownloadButtonProps) {
  const [feedback, flash] = useFeedback<number>();

  const loadedCount = state.mergedImage ? 1 : Object.keys(state.images).length;
  const disabled = !state.data || loadedCount === 0;

  async function handleClick() {
    if (!state.data) return;

    // 1. Build outputs. In merged mode: one composite file.
    //    In per-image mode: individual files if writing to a chosen folder
    //    (user picked a folder → they want files, not a zip), or the legacy
    //    zip-or-single behavior for the browser-download fallback path.
    const outputs: { name: string; blob: Blob }[] = [];
    let feedbackCount = 0;

    if (state.mode === 'merged') {
      if (!state.mergedImage) return;
      const base = state.mergedImageName.trim() || sanitizeFileName(state.data.name);
      outputs.push({
        name: `${base}.${mergedExt(state.format)}`,
        blob: dataUrlToBlob(state.mergedImage),
      });
      feedbackCount = 1;
    } else {
      if (Object.keys(state.images).length === 0) return;
      const namedAssets = collectImageAssets(state.data, state.nameOverrides);
      const ext = perImageExt(state.scale, state.format);
      const perFile: { name: string; data: Uint8Array }[] = [];

      for (const asset of namedAssets) {
        const dataUrl = state.images[asset.nodeId];
        if (!dataUrl) continue;
        const buffer = await dataUrlToBlob(dataUrl).arrayBuffer();
        perFile.push({
          name: asset.fileName.replace(/\.png$/, `.${ext}`),
          data: new Uint8Array(buffer),
        });
      }
      if (perFile.length === 0) return;
      feedbackCount = perFile.length;

      if (fsaSupported && dirHandle) {
        // FSA path: one Blob per file, no zip wrapper.
        for (const f of perFile) {
          outputs.push({ name: f.name, blob: new Blob([f.data as BlobPart]) });
        }
      } else if (perFile.length === 1) {
        outputs.push({ name: perFile[0].name, blob: new Blob([perFile[0].data as BlobPart]) });
      } else {
        // Fallback: bundle into one zip so the user only sees one download prompt.
        outputs.push({
          name: `${sanitizeFileName(state.data.name)}_images.zip`,
          blob: createZip(perFile),
        });
      }
    }

    // 2. Write. `ensurePermission` must be awaited inside this user-gesture
    //    handler so the re-grant prompt (on a stale handle) is permitted.
    const fsaReady = fsaSupported && !!dirHandle && (await ensurePermission(dirHandle));
    if (fsaReady && dirHandle) {
      try {
        for (const o of outputs) await writeFileToDir(dirHandle, o.name, o.blob);
      } catch {
        // Mid-stream failure: fall back so the user still gets their files
        // rather than losing whatever was queued.
        for (const o of outputs) downloadBlob(o.name, o.blob);
      }
    } else {
      for (const o of outputs) downloadBlob(o.name, o.blob);
    }
    flash(feedbackCount);
  }

  const label = feedback != null ? `${feedback} saved!` : 'Download image';
  const cls = feedback != null ? 'btn-candy btn-candy-sm saved' : 'btn-candy btn-candy-sm';

  return (
    <button class={cls} disabled={disabled} onClick={handleClick}>
      {label}
    </button>
  );
}

// ── ExportCard root ────────────────────────────────────
export function ExportCard({ state, dispatch }: Props) {
  // One tree walk per selection, shared with PreviewArea / RenamesList / DownloadButton.
  const assets = useMemo(() => (state.data ? collectImageAssets(state.data) : []), [state.data]);

  // Folder-picker state is local to this card — the reducer doesn't care where
  // files land. `useMemo` pins the capability check (stable for the session).
  const fsaSupported = useMemo(() => isFsaSupported(), []);
  const [dirHandle, setDirHandle] = useState<FsaDirectoryHandle | null>(null);

  useEffect(() => {
    if (!fsaSupported) return;
    let cancelled = false;
    loadDirHandle<FsaDirectoryHandle>().then((h) => {
      if (!cancelled) setDirHandle(h);
    });
    return () => {
      cancelled = true;
    };
  }, [fsaSupported]);

  async function handlePickDirectory() {
    const h = await pickDirectory();
    if (!h) return; // user cancelled or API blew up — keep whatever we had
    await saveDirHandle(h);
    setDirHandle(h);
  }

  if (!state.data) return null;

  // "Orig" disabled in merged or non-PNG (mirrors reconcileScale in state.ts).
  const origForbidden = state.mode === 'merged' || state.format !== 'PNG';
  const scaleOptions = SCALE_OPTIONS.map((o) => ({ ...o, disabled: o.value === '0' && origForbidden }));
  const modeOptions = MODE_OPTIONS.map((o) => ({ ...o, disabled: o.value === 'per-image' && assets.length === 0 }));

  const namesToggleText = state.mode === 'merged'
    ? 'Rename file'
    : assets.length === 1
      ? 'Rename 1 image'
      : `Rename ${assets.length} images`;

  return (
    <section class="export-card" aria-label="Export image">
      <PreviewArea state={state} assets={assets} />

      <ButtonGroup
        ariaLabel="Output mode"
        variant="segmented"
        options={modeOptions}
        value={state.mode}
        onChange={(v) => dispatch({ type: 'MODE_CHANGED', mode: v })}
      />

      <div class="option-row option-row-combined">
        <ButtonGroup
          ariaLabel="Size"
          variant="chip"
          options={scaleOptions}
          value={String(state.scale)}
          onChange={(v) => dispatch({ type: 'SCALE_CHANGED', scale: Number(v) })}
        />
        <span class="chip-divider" aria-hidden="true" />
        <ButtonGroup
          ariaLabel="Format"
          variant="chip"
          options={FORMAT_OPTIONS}
          value={state.format}
          onChange={(v) => dispatch({ type: 'FORMAT_CHANGED', format: v })}
        />
      </div>

      {/* Re-key on selection so a new frame starts collapsed (matches user expectation). */}
      <details key={state.data.id} class="names-row">
        <summary class="names-toggle">
          <span>{namesToggleText}</span>
        </summary>
        <div class="names-list">
          <RenamesList state={state} assets={assets} dispatch={dispatch} />
        </div>
      </details>

      {fsaSupported && <FolderPickerRow dir={dirHandle} onPick={handlePickDirectory} />}

      <DownloadButton state={state} dirHandle={dirHandle} fsaSupported={fsaSupported} />
    </section>
  );
}
