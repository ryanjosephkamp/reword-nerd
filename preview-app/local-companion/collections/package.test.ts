import { describe, expect, it } from "vitest";
import { textFixture, projectFixture, imageFixture, OWNED_DOCS, OWNED_PROJECT } from "./fixtures";
import { loadCollection } from "./package";
import { canonical } from "../../src/collections/codec";
import { prepareCollectionStage, parseCollectionResponse, imageCollectionPrompt } from "../../src/collections/stages";
import { COLLECTION_STAGES } from "../../src/collections/limits";
import type { CollectionResponses } from "../../src/collections/prepare";
const bytes = (v: unknown) => new TextEncoder().encode(canonical(v));
describe("real public collection artifacts", () => {
  it("round-trips three independent documents and all four item-local canonical stages", async () => {
    const e = (await loadCollection(bytes(await textFixture()))).envelope;
    expect(e.expectedOutputs.map(o => o.memberId)).toEqual(OWNED_DOCS.map(d => d.id));
    const history: CollectionResponses = {};
    for (const stage of COLLECTION_STAGES) {
      const { ticket, prompt } = await prepareCollectionStage(e, stage, history);
      expect(prompt).toContain("Literal");
      const { members, ...identity } = ticket;
      const raw = JSON.stringify({ ...identity, results: members.map(m => ({ ...m, response: `${m.id} ${stage} \r\n  $& <<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>> 雪` })) });
      const r = parseCollectionResponse(raw, ticket); expect(r.valid).toBe(true); history[stage] = r.results;
      if (stage === "final") expect(members.every(m => Object.keys(m.priorResponseSha256).length === 3)).toBe(true);
      for (const list of [members.slice(1), [...members].reverse(), [...members, members[0]]]) expect(parseCollectionResponse(JSON.stringify({ ...identity, results: list.map(m => ({ ...m, response: "x" })) }), ticket).valid).toBe(false);
    }
  });
  it("delivers every included mixed project path, protected syntax and exclusions", async () => {
    const e = (await loadCollection(bytes(await projectFixture()))).envelope;
    const expectedPaths = OWNED_PROJECT.slice(0, 7).map(([p]) => p).sort();
    expect(e.expectedOutputs.map(o => o.path).sort()).toEqual(expectedPaths);
    const { prompt } = await prepareCollectionStage(e, "decompose");
    for (const path of expectedPaths) expect(prompt).toContain(path);
    expect(prompt).toContain("Protected executable syntax"); expect(prompt).not.toContain("EXCLUDED-CANARY");
  });
  it("retains two distinct original PNGs including caBX and scoped output identities", async () => {
    const f = await imageFixture(), e = (await loadCollection(bytes(f.envelope))).envelope;
    expect(new Set(e.members.map(m => m.sourceSha256)).size).toBe(2);
    const prompt = imageCollectionPrompt(e);
    expect(prompt).toContain("image-1/rendition"); expect(prompt).toContain("image-2/rendition");
    expect(prompt).toContain("reference-01-"); expect(prompt).toContain("reference-02-");
  });
  it("rejects source, prompt, settings, inventory, wrong kind and identity tampering", async () => {
    const e = await textFixture();
    for (const mutate of [(x: typeof e) => { x.members[0].sourceSha256 = "0".repeat(64); }, (x: typeof e) => { x.members[0].prompts!.manual.final += "changed"; }, (x: typeof e) => { x.expectedOutputs.pop(); }, (x: typeof e) => { x.members[1].id = x.members[0].id; }, (x: typeof e) => { x.members[0].kind = "image"; }]) {
      const bad = structuredClone(e); mutate(bad); await expect(loadCollection(bytes(bad))).rejects.toThrow();
    }
  });
});
