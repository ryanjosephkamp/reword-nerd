interface SavedReference { id?: string; jobId?: string; seal?: string; snapshotSha256?: string }
export function stableSavedValue<T>(previous: T, next: T): T { return Object.is(previous, next) || JSON.stringify(previous) === JSON.stringify(next) ? previous : next; }
/** Keep disconnected references; unchanged polls must not rewrite a large workspace. */
export function mergeSavedReferences<T extends SavedReference>(previous: T[], incoming: T[]): T[] {
  const records = new Map(previous.map(record => [record.id ?? record.jobId, record]));
  for (const record of incoming) {
    const id = record.id ?? record.jobId; if (typeof id !== "string" || !id) throw Error("Invalid saved job identity.");
    const old = records.get(id);
    for (const key of ["seal", "snapshotSha256"] as const) if (old?.[key] && record[key] && old[key] !== record[key]) throw Error("Saved job identity has a different frozen binding. Earlier evidence was preserved.");
    records.set(id, old ? stableSavedValue(old, record) : record);
  }
  if (records.size > 256) throw Error("Saved job-reference limit exceeded. Export this workspace before starting another one.");
  return stableSavedValue(previous, [...records.values()]);
}
