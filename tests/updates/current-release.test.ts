import ledger from "../../content/updates/releases.json";
import { describe, expect, it } from "vitest";
import { CURRENT_RELEASE_POST_PATH, CURRENT_RELEASE_SLUG, CURRENT_RELEASE_VERSION } from "../../src/updates/currentRelease";

describe("current release discovery", () => {
  it("derives the workbench release destination from the JSON-authoritative current ledger entry", () => {
    // This catches the footer's release route drifting from the current release record.
    const current = ledger.entries.find((entry) => entry.kind === "release" && entry.status === "current");
    expect(current).toMatchObject({ slug: "v0-7-0", version: "0.7.0" });
    expect(CURRENT_RELEASE_SLUG).toBe(current?.slug);
    expect(CURRENT_RELEASE_VERSION).toBe(current?.version);
    expect(CURRENT_RELEASE_POST_PATH).toBe(`/updates/${current?.slug}/`);
  });
});
