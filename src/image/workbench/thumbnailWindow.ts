export const MAX_ACTIVE_IMAGE_THUMBNAILS = 24;

export interface ImageThumbnailWindowInput {
  readonly itemIds: readonly string[];
  readonly focusedId: string | null;
  readonly nearVisibleIds: readonly string[];
  readonly previousRecency: readonly string[];
  readonly observerAvailable: boolean;
}

export interface ImageThumbnailWindow {
  readonly activeIds: readonly string[];
  readonly recency: readonly string[];
}

export function updateImageThumbnailWindow(input: ImageThumbnailWindowInput): ImageThumbnailWindow {
  const known = new Set(input.itemIds);
  if (!input.observerAvailable) {
    const activeIds = input.itemIds.slice(0, MAX_ACTIVE_IMAGE_THUMBNAILS);
    if (input.focusedId && known.has(input.focusedId) && !activeIds.includes(input.focusedId)) {
      activeIds.splice(Math.max(0, MAX_ACTIVE_IMAGE_THUMBNAILS - 1), 1, input.focusedId);
    }
    return { activeIds, recency: activeIds };
  }

  const recency = input.previousRecency.filter((id, index, values) => known.has(id)
    && values.indexOf(id) === index);
  for (const id of input.nearVisibleIds) {
    if (!known.has(id)) continue;
    const previous = recency.indexOf(id);
    if (previous >= 0) recency.splice(previous, 1);
    recency.push(id);
  }
  for (const id of input.itemIds) {
    if (!recency.includes(id)) recency.unshift(id);
  }
  const activeIds = recency.slice(-MAX_ACTIVE_IMAGE_THUMBNAILS);
  if (input.focusedId && known.has(input.focusedId) && !activeIds.includes(input.focusedId)) {
    const replace = activeIds.findIndex((id) => id !== input.focusedId);
    if (replace >= 0) activeIds.splice(replace, 1, input.focusedId);
  }
  return { activeIds, recency };
}
