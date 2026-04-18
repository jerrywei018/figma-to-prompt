import type { UISerializedNode } from './types';

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Key the exported image by rendered appearance, not only the underlying Figma image hash. */
export function getImageAssetKey(node: UISerializedNode): string | undefined {
  const style = node.style;
  if (!style?.imageFillHash) return undefined;

  return stableStringify({
    hash: style.imageFillHash,
    width: node.layout?.width,
    height: node.layout?.height,
    scaleMode: style.imageFillScaleMode,
    transform: style.imageFillTransform,
    scalingFactor: style.imageFillScalingFactor,
    rotation: style.imageFillRotation,
    filters: style.imageFillFilters,
    imageOpacity: style.imageFillOpacity,
    imageBlendMode: style.imageFillBlendMode,
    nodeOpacity: style.opacity,
    borderRadius: style.borderRadius,
    cornerRadii: style.cornerRadii,
  });
}

export function hasRenderSpecificImagePaint(node: UISerializedNode): boolean {
  const style = node.style;
  if (!style?.imageFillHash) return false;
  return Boolean(
    style.imageFillTransform ||
      style.imageFillScalingFactor !== undefined ||
      style.imageFillRotation !== undefined ||
      style.imageFillFilters ||
      style.imageFillOpacity !== undefined ||
      style.imageFillBlendMode ||
      style.imageFillScaleMode === 'crop' ||
      style.imageFillScaleMode === 'tile',
  );
}
