// Shared browser/official-adapter contract. No private catalog or model-name heuristics.
export const CATALOG_TTL_MS = 15 * 60 * 1000;
export const RUNTIME_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
export const EFFORT_ID = /^[a-z][a-z0-9_-]{0,31}$/;
export function normalizeCatalog(pages, now = Date.now()) {
  if (!Array.isArray(pages) || !pages.length || pages.length > 16) throw Error("Missing or oversized model catalog");
  const models = [], ids = new Set();
  for (const page of pages) {
    if (!Array.isArray(page.data) || page.data.length > 100) throw Error("Invalid model catalog page");
    for (const m of page.data) {
      if (!RUNTIME_ID.test(m.model) || typeof m.displayName !== "string" || m.displayName.length > 256
        || !Array.isArray(m.supportedReasoningEfforts) || m.supportedReasoningEfforts.length > 16
        || !Array.isArray(m.inputModalities) || m.inputModalities.some(v => !["text", "image", "audio"].includes(v))) throw Error("Unsupported model catalog metadata");
      if (ids.has(m.model)) throw Error("Duplicate catalog model ID");
      ids.add(m.model);
      const efforts = m.supportedReasoningEfforts.map(e => e.reasoningEffort);
      if (!efforts.length || new Set(efforts).size !== efforts.length || efforts.some(e => !EFFORT_ID.test(e))) throw Error("Invalid model effort metadata");
      models.push({ id: m.model, name: m.displayName, efforts, inputModalities: [...m.inputModalities], hidden: m.hidden === true });
    }
  }
  if (!models.length || models.length > 512) throw Error("Empty or oversized model catalog");
  return { version: 1, source: "Codex app-server model/list", fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now + CATALOG_TTL_MS).toISOString(), models, contextWindowTokens: null, imageGenerator: "harness-managed/unknown" };
}
export async function discoverCatalog(request, now = Date.now()) {
  const pages = [], cursors = new Set();
  let cursor = null;
  do {
    if (pages.length >= 16) throw Error("Model catalog pagination bound exceeded");
    const page = await request("model/list", { cursor, limit: 100, includeHidden: true });
    pages.push(page);
    cursor = page.nextCursor;
    if (cursor !== null && (typeof cursor !== "string" || !cursor || cursor.length > 4096 || cursors.has(cursor))) throw Error("Invalid or repeated model catalog cursor");
    if (cursor) cursors.add(cursor);
  } while (cursor !== null);
  return normalizeCatalog(pages, now);
}
export function resolveRuntime(catalog, requested, operation = "text", now = Date.now()) {
  if (!requested || typeof requested.model !== "string" || typeof requested.effort !== "string"
    || Object.keys(requested).sort().join(",") !== "effort,model") throw Error("Choose a model and effort explicitly");
  const { model, effort } = requested;
  if (!model || model.length > 256 || model !== model.trim() || !EFFORT_ID.test(effort)) throw Error("Malformed model or effort identifier");
  if (!catalog || catalog.version !== 1 || !Number.isFinite(Date.parse(catalog.expiresAt)) || now >= Date.parse(catalog.expiresAt)) throw Error("Model catalog unavailable or stale; refresh before confirmation");
  const matches = catalog.models.filter(m => m.id.toLowerCase() === model.toLowerCase() || m.name.toLowerCase() === model.toLowerCase());
  if (matches.length > 1) throw Error("Ambiguous model name; choose an unambiguous catalog identifier");
  const selected = matches[0];
  if (!selected) {
    if (!RUNTIME_ID.test(model)) throw Error("Malformed typed model identifier");
    return { model, effort, availability: "unverified", dispatchable: false, reason: "Typed ID retained exactly. This adapter has no established effective operation boundary for an unlisted model.", imageGenerator: "harness-managed/unknown" };
  }
  if (!selected.efforts.includes(effort)) throw Error("Unsupported effort for this model");
  if (!selected.inputModalities.includes(operation === "image" ? "image" : "text")) throw Error("Model catalog does not support the requested input modality");
  return { model: selected.id, effort, availability: "catalog", dispatchable: true, catalogFetchedAt: catalog.fetchedAt, imageGenerator: "harness-managed/unknown" };
}
