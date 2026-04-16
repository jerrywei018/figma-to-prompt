import { collectImageAssets } from './prompt';
import type { ExportMode, ImageFormat, ImageNameOverrides, UISerializedNode } from '../shared/types';

export type Tab = 'json' | 'prompt';

export interface State {
  data: UISerializedNode | null;
  tab: Tab;
  images: Record<string, string>;
  mergedImage: string | null;
  scale: number; // 0 = original (getImageByHash), 1..4 = px multiplier
  format: ImageFormat;
  mode: ExportMode;
  nameOverrides: ImageNameOverrides;
  mergedImageName: string;
  /** Bumped whenever we need sandbox to re-export. Observed by an effect that postMessages. */
  exportRequestId: number;
  protocolMismatch: boolean;
  updateAvailable: { version: string; url: string } | null;
}

export const initialState: State = {
  data: null,
  tab: 'json',
  images: {},
  mergedImage: null,
  scale: 0,
  format: 'PNG',
  mode: 'per-image',
  nameOverrides: {},
  mergedImageName: '',
  exportRequestId: 0,
  protocolMismatch: false,
  updateAvailable: null,
};

export type Action =
  | { type: 'SELECTION_EMPTY' }
  | { type: 'SELECTION_RECEIVED'; data: UISerializedNode }
  | { type: 'IMAGES_RECEIVED'; images: Record<string, string>; merged?: string }
  | { type: 'TAB_CHANGED'; tab: Tab }
  | { type: 'MODE_CHANGED'; mode: ExportMode }
  | { type: 'SCALE_CHANGED'; scale: number }
  | { type: 'FORMAT_CHANGED'; format: ImageFormat }
  | { type: 'NAME_OVERRIDE_CHANGED'; id: string; value: string }
  | { type: 'MERGED_NAME_CHANGED'; value: string }
  | { type: 'PROTOCOL_MISMATCH' }
  | { type: 'UPDATE_AVAILABLE'; version: string; url: string };

/** Mirrors the original `reconcileScaleAvailability`:
 *  Orig (scale=0) only makes sense in per-image PNG mode. Anywhere else it would
 *  silently fall back to 1×, so we visibly bump it. */
function reconcileScale(scale: number, mode: ExportMode, format: ImageFormat): number {
  const origForbidden = mode === 'merged' || format !== 'PNG';
  return origForbidden && scale === 0 ? 1 : scale;
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SELECTION_EMPTY':
      // Preserve user UI preferences across selections; reset only selection-bound state.
      return {
        ...initialState,
        tab: state.tab,
        scale: state.scale,
        format: state.format,
        mode: state.mode,
        protocolMismatch: state.protocolMismatch,
        updateAvailable: state.updateAvailable,
      };

    case 'SELECTION_RECEIVED': {
      const { data } = action;
      const hasImages = collectImageAssets(data).length > 0;
      // Per-image mode is meaningless without image fills — force merged.
      const mode: ExportMode = !hasImages && state.mode === 'per-image' ? 'merged' : state.mode;
      const scale = reconcileScale(state.scale, mode, state.format);
      // Sandbox auto-triggers a per-image export on selection change. We only need to
      // re-request when our local mode is merged (or was just forced to merged).
      const needsRequest = mode === 'merged';
      // JSON / prompt text are derived lazily by CodePanel via useMemo so rapid
      // selection changes don't pay both JSON.stringify + buildPrompt eagerly
      // on every click. Only the active tab's string is ever computed.
      return {
        ...state,
        data,
        images: {},
        mergedImage: null,
        nameOverrides: {},
        mergedImageName: '',
        mode,
        scale,
        exportRequestId: needsRequest ? state.exportRequestId + 1 : state.exportRequestId,
      };
    }

    case 'IMAGES_RECEIVED':
      return { ...state, images: action.images, mergedImage: action.merged ?? null };

    case 'TAB_CHANGED':
      return { ...state, tab: action.tab };

    case 'MODE_CHANGED': {
      const mode = action.mode;
      const scale = reconcileScale(state.scale, mode, state.format);
      // Intentionally keep the previous preview (images / mergedImage) visible
      // until the new export lands — avoids a flash of blank "No images to
      // export" between toggles. The StatusBar still shows "loading…" via the
      // exportRequestId round-trip so users know something is in flight.
      return {
        ...state,
        mode,
        scale,
        exportRequestId: state.data ? state.exportRequestId + 1 : state.exportRequestId,
      };
    }

    case 'SCALE_CHANGED':
      // Same rationale as MODE_CHANGED — keep stale preview around so the UI
      // doesn't flicker while the new render is in flight.
      return {
        ...state,
        scale: action.scale,
        exportRequestId: state.data ? state.exportRequestId + 1 : state.exportRequestId,
      };

    case 'FORMAT_CHANGED': {
      const format = action.format;
      const scale = reconcileScale(state.scale, state.mode, format);
      return {
        ...state,
        format,
        scale,
        exportRequestId: state.data ? state.exportRequestId + 1 : state.exportRequestId,
      };
    }

    case 'NAME_OVERRIDE_CHANGED': {
      const overrides = { ...state.nameOverrides };
      if (action.value === '') delete overrides[action.id];
      else overrides[action.id] = action.value;
      return { ...state, nameOverrides: overrides };
    }

    case 'MERGED_NAME_CHANGED':
      return { ...state, mergedImageName: action.value };

    case 'PROTOCOL_MISMATCH':
      return { ...state, protocolMismatch: true };

    case 'UPDATE_AVAILABLE':
      return { ...state, updateAvailable: { version: action.version, url: action.url } };
  }
}
