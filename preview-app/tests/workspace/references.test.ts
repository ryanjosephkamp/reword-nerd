import { expect, it } from "vitest";
import { mergeSavedReferences } from "../../src/workspace/references";
it("retains older job references and stable identity when a status poll changes nothing", () => {
  const old = [{ id: "old", seal: "a", status: "unknown-after-recovery" }, { id: "new", seal: "b", status: "complete" }];
  expect(mergeSavedReferences(old, [{ ...old[1] }])).toBe(old);
  const changed = mergeSavedReferences(old, [{ ...old[1], status: "awaiting-review" }]);
  expect(changed.map(r => r.id)).toEqual(["old", "new"]);
  expect(changed[1].status).toBe("awaiting-review"); expect(changed[0]).toBe(old[0]);
});
it("rejects an existing job ID presented with a different frozen binding", () => {
  expect(() => mergeSavedReferences([{ id: "same", seal: "original" }], [{ id: "same", seal: "different" }])).toThrow(/binding|identity/i);
});
