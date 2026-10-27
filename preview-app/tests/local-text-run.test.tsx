import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto, createHash } from "node:crypto";
import {
  LocalTextRun,
  type LocalTextSource,
} from "../src/app/platform/LocalTextRun";
import { CURATED_MODEL_PROFILES, DEFAULT_SETTINGS } from "../src/domain";
const mock = vi.hoisted(() => ({ request: vi.fn(), job: null as unknown }));
vi.mock("../src/app/platform/localClient", () => ({
  localRequest: mock.request,
}));
vi.mock("../src/export", () => ({
  buildPromptPackage: vi.fn(async () => ({
    ok: true,
    blob: new Blob(["synthetic zip"]),
  })),
}));
const source: LocalTextSource = {
  document: {
    id: "owned",
    name: "owned.md",
    text: "Owned source\n",
    originalText: "Owned source\n",
    status: "ready",
    format: "markdown",
    warnings: [],
    contextWarningAcknowledged: true,
    original: new File(["Owned source\n"], "owned.md"),
  },
  settings: { ...DEFAULT_SETTINGS },
  profile: CURATED_MODEL_PROFILES[0],
};
const job = {
  id: "fixture",
  documentName: "owned.md",
  status: "awaiting-user-review",
  location: "/owned",
  sourceSha256: createHash("sha256").update(source.document.text).digest("hex"),
  packageSha256: "a".repeat(64),
  modelTurns: 4,
  final: "<script>window.bad=1</script>\nFixture output",
  artifacts: ["final.md"],
  executor: { model: "offline fixture", effort: "medium" },
  runner: { stages: [{ stage: "final", status: "response-recorded" }] },
};
beforeEach(() => {
  mock.job = null;
  vi.stubGlobal("crypto", webcrypto);
  mock.request.mockReset();
  mock.request.mockImplementation(async (action: string) => ({
    ok: true,
    json: async () =>
      action === "capabilities"
        ? {
            available: true,
            session: "a".repeat(64),
            location: "/owned",
            capabilities: {
              kind: "reword-nerd-local-text",
              model: "fixture",
              effort: "medium",
              retention: "fixture",
            },
          }
        : action === "run"
          ? { job: (mock.job = job) }
          : { job: mock.job },
  }));
});
describe("local run review and frozen-source behavior (synthetic)", () => {
  it("requires explicit review again after source/settings change", async () => {
    const view = render(<LocalTextRun source={source} />);
    const run = await screen.findByRole("button", { name: "Run four stages" });
    expect(run).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(run).toBeEnabled();
    view.rerender(
      <LocalTextRun
        source={{
          ...source,
          settings: { ...source.settings, tone: "technical" },
        }}
      />,
    );
    expect(run).toBeDisabled();
    expect(mock.request.mock.calls.some((x) => x[0] === "run")).toBe(false);
  });
  it("keeps hostile output inert and association explicit/stale after edits", async () => {
    const view = render(<LocalTextRun source={source} />);
    await screen.findByRole("button", { name: "Run four stages" });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Run four stages" }));
    await screen.findByText(/Fixture output/);
    expect(document.querySelector("script")).toBeNull();
    expect(screen.queryByText(/Explicitly associated/)).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Associate with matching selected source",
      }),
    );
    await screen.findByText(
      "Explicitly associated with this unchanged source.",
    );
    view.rerender(
      <LocalTextRun
        source={{
          ...source,
          document: {
            ...source.document,
            text: "Edited while result is retained",
          },
        }}
      />,
    );
    await screen.findByText(/Association is stale/);
    expect(screen.getByText(/Fixture output/)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Associate with matching selected source",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("does not match"),
    );
    expect(screen.getByRole("link", { name: "final.md" })).toHaveAttribute(
      "href",
      "/api/artifact/final.md",
    );
  });
});
