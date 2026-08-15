export function parseImagePdfPages(value: string, pageCount: number): readonly number[] | null {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return null;
  const pages = new Set<number>();
  for (const rawPart of value.split(",")) {
    const part = rawPart.trim();
    if (!part) return null;
    const range = /^(\d+)-(\d+)$/u.exec(part);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start < 1 || end > pageCount || start > end) return null;
      for (let page = start; page <= end; page += 1) pages.add(page);
      continue;
    }
    if (!/^\d+$/u.test(part)) return null;
    const page = Number(part);
    if (!Number.isSafeInteger(page) || page < 1 || page > pageCount) return null;
    pages.add(page);
  }
  return pages.size > 0 ? [...pages].sort((left, right) => left - right) : null;
}
