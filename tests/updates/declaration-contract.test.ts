import { describe, expectTypeOf, it } from "vitest";
import type {
  ReleaseLedgerArticleEntry,
  ReleaseLedgerEntry,
  ReleaseLedgerReleaseEntry,
  ReleaseLedgerV1,
} from "../../scripts/updates/lib.mjs";

describe("ReleaseLedgerV1 declaration contract", () => {
  it("discriminates release-only fields from article entries", () => {
    // Removing release-only version/classification fields or broadening article entries must make this compile-time contract fail.
    const release = {
      kind: "release",
      slug: "v0-7-0",
      title: "reword-nerd v0.7",
      summary: "A static Updates journal.",
      status: "current",
      date: "2026-08-13",
      author: "Ryan Joseph Kamp",
      tags: ["release"],
      relatedPrs: [],
      markdownPath: "content/updates/v0-7-0.md",
      visualChanges: true,
      video: { policy: "exempt", exemptionReason: "Text covers the change." },
      version: "0.7.0",
      classification: "feature",
    } satisfies ReleaseLedgerReleaseEntry;
    const article = {
      kind: "article",
      slug: "road-to-v0-6",
      title: "Road to v0.6",
      summary: "A retrospective.",
      status: "published",
      date: "2026-08-13",
      author: "Ryan Joseph Kamp",
      tags: ["retrospective"],
      relatedPrs: [],
      markdownPath: "content/updates/road-to-v0-6.md",
      visualChanges: false,
      video: { policy: "none" },
    } satisfies ReleaseLedgerArticleEntry;
    const ledger = {
      schemaVersion: 1,
      site: {
        title: "reword-nerd Updates",
        description: "A builder's journal.",
        canonicalOrigin: "https://ryanjosephkamp.github.io",
        basePath: "/reword-nerd/updates/",
      },
      entries: [release, article],
    } satisfies ReleaseLedgerV1;

    expectTypeOf(release.version).toMatchTypeOf<string>();
    expectTypeOf(release.classification).toMatchTypeOf<"feature" | "maintenance">();
    expectTypeOf(release).toMatchTypeOf<ReleaseLedgerEntry>();
    expectTypeOf(ledger).toMatchTypeOf<ReleaseLedgerV1>();
    // @ts-expect-error Article entries cannot declare a release version.
    const invalidArticle: ReleaseLedgerArticleEntry = { ...article, version: "0.7.0" };
    // @ts-expect-error Article entries cannot declare an explicitly undefined release version.
    const invalidUndefinedVersion: ReleaseLedgerArticleEntry = { ...article, version: undefined };
    // @ts-expect-error Article entries cannot declare an explicitly undefined release classification.
    const invalidUndefinedClassification: ReleaseLedgerArticleEntry = { ...article, classification: undefined };
    expectTypeOf(invalidArticle).toEqualTypeOf<ReleaseLedgerArticleEntry>();
    expectTypeOf(invalidUndefinedVersion).toEqualTypeOf<ReleaseLedgerArticleEntry>();
    expectTypeOf(invalidUndefinedClassification).toEqualTypeOf<ReleaseLedgerArticleEntry>();
  });
});
