import { describe, expect, it } from "vitest";
import { discoverCatalog, normalizeCatalog, resolveRuntime } from "../../src/collections/runtime.mjs";
import { forgetRuntimes, recentRuntimes, rememberRuntime } from "../../src/collections/preferences";
const now = Date.parse("2026-09-12T00:00:00Z");
const m = (model: string, displayName = model, efforts = ["medium", "high"]) => ({ model, displayName, supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort })), inputModalities: ["text", "image"] });
const catalog = () => normalizeCatalog([{ data: [m("gpt-5.6-sol", "GPT-5.6 Sol"), m("gpt-6-astra", "GPT-6 Astra", ["low", "xhigh"])], nextCursor: null }], now);
describe("explicit runtime contract", () => {
  it("paginates official metadata without executing", async () => {
    const calls: unknown[] = [];
    const c = await discoverCatalog(async (method, params) => { calls.push([method, params]); return calls.length === 1 ? { data: [m("One")], nextCursor: "page-two" } : { data: [m("Two")], nextCursor: null }; }, now);
    expect(c.models.map(v => v.id)).toEqual(["One", "Two"]);
    expect(calls[1]).toEqual(["model/list", { cursor: "page-two", limit: 100, includeHidden: true }]);
    expect(c.contextWindowTokens).toBeNull();
  });
  it("binds two distinct configurations and resolves unambiguous case", () => {
    expect(resolveRuntime(catalog(), { model: "GPT-5.6 SOL", effort: "medium" }, "text", now)).toMatchObject({ model: "gpt-5.6-sol", effort: "medium", dispatchable: true });
    expect(resolveRuntime(catalog(), { model: "GPT-6 ASTRA", effort: "xhigh" }, "image", now)).toMatchObject({ model: "gpt-6-astra", effort: "xhigh", imageGenerator: "harness-managed/unknown" });
  });
  it("preserves unknown and retired typed ID case, visibly blocks its unverified boundary", () => {
    const result = resolveRuntime(catalog(), { model: "Retired.Future-ID", effort: "medium" }, "text", now);
    expect(result).toMatchObject({ model: "Retired.Future-ID", availability: "unverified", dispatchable: false });
  });
  it("rejects missing choice, stale/missing catalogs, ambiguity and unsupported effort", () => {
    expect(() => resolveRuntime(catalog(), null, "text", now)).toThrow(/explicitly/);
    expect(() => resolveRuntime(null, { model: "gpt-5.6-sol", effort: "medium" }, "text", now)).toThrow(/stale/);
    expect(() => resolveRuntime(catalog(), { model: "gpt-5.6-sol", effort: "medium" }, "text", now + 900000)).toThrow(/stale/);
    expect(() => resolveRuntime(catalog(), { model: "gpt-6-astra", effort: "medium" }, "image", now)).toThrow(/effort/);
    const ambiguous = normalizeCatalog([{ data: [m("Alpha", "Shared"), m("alpha", "Shared")] }], now);
    expect(() => resolveRuntime(ambiguous, { model: "Alpha", effort: "medium" }, "text", now)).toThrow(/Ambiguous/);
    for (const model of [";touch /x", "$(cmd)", "-m", "a\nb", "" , "x".repeat(129)]) expect(() => resolveRuntime(catalog(), { model, effort: "medium" }, "text", now)).toThrow();
  });
  it("fails closed on repeated/missing cursors and missing modality", async () => {
    await expect(discoverCatalog(async () => ({ data: [m("a")], nextCursor: "again" }), now)).rejects.toThrow(/cursor/);
    await expect(discoverCatalog(async () => ({ data: [m("a")] }), now)).rejects.toThrow(/cursor/);
    expect(() => normalizeCatalog([{ data: [{ ...m("a"), inputModalities: undefined }] }], now)).toThrow(/metadata/);
  });
  it("remembers only five opt-in non-sensitive choices, forgets and revalidates", () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
    expect(recentRuntimes(storage)).toEqual([]);
    for (let i = 0; i < 8; i++) rememberRuntime(storage, { model: `Model-${i}`, effort: "medium" });
    expect(recentRuntimes(storage)).toHaveLength(5);
    expect(resolveRuntime(catalog(), recentRuntimes(storage)[0], "text", now).dispatchable).toBe(false);
    expect(() => rememberRuntime(storage, { model: "a", effort: "medium", path: "/source" } as never)).toThrow();
    forgetRuntimes(storage); expect(map.size).toBe(0);
  });
});
