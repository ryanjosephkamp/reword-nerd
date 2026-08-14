export const MAX_ACTIVE_IMAGE_PACKAGE_PREVIEWS = 12;

export interface ImagePackagePreviewWindowInput {
  readonly pairKeys: readonly string[];
  readonly nearVisibleKeys: readonly string[];
  readonly previousRecency: readonly string[];
  readonly observerAvailable: boolean;
}

export interface ImagePackagePreviewWindow {
  readonly activeKeys: readonly string[];
  readonly recency: readonly string[];
}

export function updateImagePackagePreviewWindow(
  input: ImagePackagePreviewWindowInput,
): ImagePackagePreviewWindow {
  if (!input.observerAvailable) {
    const activeKeys = input.pairKeys.slice(0, MAX_ACTIVE_IMAGE_PACKAGE_PREVIEWS);
    return { activeKeys, recency: activeKeys };
  }

  const known = new Set(input.pairKeys);
  const recency = input.previousRecency.filter((key, index, values) => known.has(key)
    && values.indexOf(key) === index);
  for (const key of input.pairKeys) {
    if (!recency.includes(key)) recency.unshift(key);
  }
  for (const key of input.nearVisibleKeys) {
    if (!known.has(key)) continue;
    const previous = recency.indexOf(key);
    if (previous >= 0) recency.splice(previous, 1);
    recency.push(key);
  }
  return {
    activeKeys: recency.slice(-MAX_ACTIVE_IMAGE_PACKAGE_PREVIEWS),
    recency,
  };
}
