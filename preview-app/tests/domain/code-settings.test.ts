import { describe, expect, it } from "vitest";

import { decodeSavedPreferences, encodeSavedPreferences } from "../../src/app/workbench/preferences";
import { createInitialWorkbenchState, workbenchReducer } from "../../src/app/workbench/reducer";
import { SETTINGS_HELP_CONTENT } from "../../src/app/workbench/components/settingsHelpContent";

describe("code rewrite settings", () => {
  it("uses the approved global defaults with protected executable syntax permanently enabled", async () => {
    // This catches code-bearing content becoming opt-in or executable syntax becoming user-disableable.
    const settings = await import("../../src/domain/settings");

    expect(settings.DEFAULT_CODE_REWRITE_OPTIONS).toEqual({
      documentationAndMarkup: true,
      commentsAndDocstrings: true,
      userFacingStrings: true,
      narrativeStructuredDataValues: false,
      honorRootGitignore: true,
      excludeDependenciesBuildGenerated: true,
      preserveSafeNonTextAssets: true,
      protectedExecutableSyntax: true,
    });
    expect(settings.resolveCodeRewriteOptions({ protectedExecutableSyntax: false })).toEqual(
      settings.DEFAULT_CODE_REWRITE_OPTIONS,
    );
  });

  it("validates every user-controlled option without allowing malformed values to weaken another default", async () => {
    // This catches truthy strings or partial corruption entering project classification and prompt selection.
    const settings = await import("../../src/domain/settings");

    expect(settings.resolveCodeRewriteOptions({
      commentsAndDocstrings: false,
      narrativeStructuredDataValues: true,
      preserveSafeNonTextAssets: false,
    })).toEqual({
      ...settings.DEFAULT_CODE_REWRITE_OPTIONS,
      commentsAndDocstrings: false,
      narrativeStructuredDataValues: true,
      preserveSafeNonTextAssets: false,
    });
    expect(() => settings.resolveCodeRewriteOptions({ userFacingStrings: "yes" } as never))
      .toThrowError(settings.SettingsValidationError);
  });

  it("hydrates, updates, serializes, and resets only validated global code rewrite options", async () => {
    // This catches project-wide settings being lost, corrupted, or expanded to persist project/session content.
    const decoded = decodeSavedPreferences(JSON.stringify({
      version: 1,
      data: {
        codeRewriteOptions: {
          documentationAndMarkup: false,
          commentsAndDocstrings: "false",
          narrativeStructuredDataValues: true,
          protectedExecutableSyntax: false,
          projectEntries: ["must not survive"],
        },
      },
    }));
    expect(decoded?.codeRewriteOptions).toEqual({
      documentationAndMarkup: false,
      narrativeStructuredDataValues: true,
      protectedExecutableSyntax: true,
    });

    let state = createInitialWorkbenchState(decoded);
    expect(state.globalCodeRewriteOptions).toMatchObject({
      documentationAndMarkup: false,
      commentsAndDocstrings: true,
      narrativeStructuredDataValues: true,
      protectedExecutableSyntax: true,
    });
    state = workbenchReducer(state, {
      type: "code-rewrite/global-options-changed",
      options: { ...state.globalCodeRewriteOptions, userFacingStrings: false },
    });
    expect(state.globalCodeRewriteOptions.userFacingStrings).toBe(false);

    const serialized = encodeSavedPreferences({ codeRewriteOptions: state.globalCodeRewriteOptions });
    expect(JSON.parse(serialized).data.codeRewriteOptions).toEqual(state.globalCodeRewriteOptions);
    expect(serialized).not.toMatch(/projectEntries|must not survive/);

    state = workbenchReducer(state, { type: "preferences/reset-confirmed" });
    expect(state.globalCodeRewriteOptions).toEqual((await import("../../src/domain/settings")).DEFAULT_CODE_REWRITE_OPTIONS);
  });

  it("resolves incomplete reducer payloads against defaults and ignores malformed payloads", async () => {
    // This catches reducer actions erasing omitted defaults or storing non-boolean values in live settings.
    const settings = await import("../../src/domain/settings");
    const initial = createInitialWorkbenchState(null);
    const incomplete = workbenchReducer(initial, {
      type: "code-rewrite/global-options-changed",
      options: { commentsAndDocstrings: false },
    } as never);

    expect(incomplete.globalCodeRewriteOptions).toEqual({
      ...settings.DEFAULT_CODE_REWRITE_OPTIONS,
      commentsAndDocstrings: false,
    });
    const malformed = workbenchReducer(incomplete, {
      type: "code-rewrite/global-options-changed",
      options: { userFacingStrings: "yes" },
    } as never);
    expect(malformed).toBe(incomplete);
  });

  it("provides distinct help contracts for every new control", () => {
    // This catches two controls sharing ambiguous help or omitting their prompt/package boundary.
    expect(SETTINGS_HELP_CONTENT).toMatchObject({
      documentationAndMarkup: "Includes prose in documentation and markup while preserving tags, attributes, links, and structure.",
      commentsAndDocstrings: "Includes comments and docstrings for rewriting while keeping surrounding executable syntax unchanged.",
      userFacingStrings: "Includes strings shown to users. Identifiers, protocol values, placeholders, and other executable strings stay protected.",
      narrativeStructuredDataValues: "Includes prose-like values in JSON, YAML, TOML, INI, and config files. Keys, types, numbers, and structure stay protected.",
      honorRootGitignore: "Applies the project root .gitignore locally when deciding initial exclusions. No files or patterns leave this browser.",
      excludeDependenciesBuildGenerated: "Excludes dependencies, vendor, cache, build, generated, minified, source-map, and lock content by default.",
      preserveSafeNonTextAssets: "Keeps safe non-text assets in the sanitized project package without placing their bytes in prompts.",
      protectedExecutableSyntax: "Always on. Preserves executable syntax, control flow, identifiers, imports, signatures, paths, and structural tokens.",
    });
  });
});
