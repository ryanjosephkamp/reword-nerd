import {
  createInitialImagePortalState,
  type ImagePortalState,
} from "../src/image/reducer";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { localTextPackage } from "../src/app/platform/localTextPackage";
import { HarnessHandoff } from "../src/app/platform/HarnessHandoff";
import type { LocalTextSource } from "../src/app/platform/LocalTextRun";
import { CURATED_MODEL_PROFILES, DEFAULT_SETTINGS } from "../src/domain";
const mock = vi.hoisted(() => ({ request: vi.fn(), records: [] as unknown[] }));
vi.mock("../src/app/platform/handoffClient", () => ({
  handoffRequest: mock.request,
}));
vi.mock("../src/app/platform/localTextPackage", () => ({
  localTextPackage: vi.fn(async () => new Blob(["owned fixture zip"])),
}));
const source: LocalTextSource = {
  document: {
    id: "owned",
    name: "owned.md",
    text: "Owned source",
    originalText: "Owned source",
    status: "ready",
    format: "markdown",
    warnings: [],
    contextWarningAcknowledged: true,
    original: new File(["Owned source"], "owned.md"),
  },
  settings: { ...DEFAULT_SETTINGS },
  profile: CURATED_MODEL_PROFILES[0],
};
const record = {
  id: "7b6e74b4-dc18-42f5-ad41-df823710acee",
  sourceKind: "text",
  displayName: "owned.md",
  phase: "prepared",
  prompt: "<script>window.hostile=1</script>\n$& $$ café",
  promptSha256: "a".repeat(64),
  referenceSha256: "b".repeat(64),
  packageSha256: "c".repeat(64),
  snapshotSha256: "d".repeat(64),
  workflow: "canonical-one-shot-text",
  location: "/owned",
  events: [],
  artifacts: ["prompt.txt", "handoff.zip"],
};
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  mock.records = [];
  vi.mocked(localTextPackage).mockClear();
  mock.request.mockReset();
  mock.request.mockImplementation(async (action: string) => ({
    ok: true,
    json: async () =>
      action === "capabilities"
        ? {
            kind: "reword-outbound-handoff",
            session: "a".repeat(64),
            terminalReviewAvailable: true,
            version: "codex-cli 0.153.4",
            reason: "No model starts from the browser",
            location: "/owned",
            claude: { available: false, reason: "No attachment contract" },
          }
        : action === "prepare"
          ? { handoff: (mock.records = [record])[0] }
          : action === "open"
            ? {
                handoff: {
                  ...record,
                  phase: "launch-requested-unconfirmed",
                  events: [{ file: "launch-requested.json" }],
                },
              }
            : { handoffs: mock.records },
  }));
});
async function prep() {
  await screen.findByRole("combobox");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "text" } });
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I reviewed this source/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Review handoff" }));
  await screen.findByRole("region", { name: "Outgoing handoff review" });
}
describe("outbound handoff UI, synthetic data only", () => {
  it("requires separate source and outgoing review; never claims model execution", async () => {
    render(<HarnessHandoff imageState={null} source={source} />);
    await prep();
    const open = screen.getByRole("button", {
      name: "Open terminal review",
    });
    expect(open).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I checked the outgoing/ }),
    );
    expect(open).toBeEnabled();
    fireEvent.click(open);
    await screen.findByText(
      /Target: Codex terminal. Status: launch-requested-unconfirmed/,
    );
    expect(open).toBeDisabled();
    expect(mock.request.mock.calls.filter((x) => x[0] === "open")).toHaveLength(
      1,
    );
    expect(screen.getByText(/Codex task start/)).toBeInTheDocument();
  });
  it("preserves the prepared snapshot but prevents launch after source changes", async () => {
    const view = render(<HarnessHandoff imageState={null} source={source} />);
    await prep();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I checked the outgoing/ }),
    );
    view.rerender(
      <HarnessHandoff
        imageState={null}
        source={{
          ...source,
          document: { ...source.document, text: "Edited later" },
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Open terminal review" }),
    ).toBeDisabled();
    expect(screen.getByText(/current source differs/)).toBeInTheDocument();
    expect(document.querySelector(".handoff-outgoing pre")?.textContent).toBe(
      record.prompt,
    );
    expect(mock.request.mock.calls.some((x) => x[0] === "open")).toBe(false);
  });
  it("renders hostile text as inert data and downloads only bound artifact URLs", async () => {
    const { container } = render(
      <HarnessHandoff imageState={null} source={source} />,
    );
    await prep();
    expect(container.querySelector("script")).toBeNull();
    expect(document.querySelector(".handoff-outgoing pre")?.textContent).toBe(
      record.prompt,
    );
    expect(screen.getByRole("link", { name: "handoff.zip" })).toHaveAttribute(
      "href",
      `/api/handoff/artifact/${record.id}/handoff.zip`,
    );
  });
  it("retains review state when the shell hides and restores the mounted mode", async () => {
    const view = render(
      <section hidden={false}>
        <HarnessHandoff imageState={null} source={source} />
      </section>,
    );
    await prep();
    view.rerender(
      <section hidden>
        <HarnessHandoff imageState={null} source={source} />
      </section>,
    );
    view.rerender(
      <section hidden={false}>
        <HarnessHandoff imageState={null} source={source} />
      </section>,
    );
    expect(
      screen.getByRole("region", { name: "Outgoing handoff review" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /I reviewed this source/ }),
    ).toBeChecked();
  });
  it("reuses the exact frozen ZIP for repeats and explicit resend instead of regenerating timestamps", async () => {
    render(<HarnessHandoff imageState={null} source={source} />);
    await prep();
    fireEvent.click(screen.getByRole("button", { name: "Review handoff" }));
    await waitFor(() =>
      expect(
        mock.request.mock.calls.filter((x) => x[0] === "prepare"),
      ).toHaveLength(2),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I checked the outgoing/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open terminal review" }),
    );
    const resend = await screen.findByRole("button", {
      name: "Prepare explicit resend for review",
    });
    fireEvent.click(resend);
    await waitFor(() =>
      expect(
        mock.request.mock.calls.filter((x) => x[0] === "prepare"),
      ).toHaveLength(3),
    );
    const sends = mock.request.mock.calls.filter((x) => x[0] === "prepare");
    expect(sends[0][1].body).toBe(sends[1][1].body);
    expect(sends[0][1].body).toBe(sends[2][1].body);
    expect(sends[0][1].requestId).toBe(sends[1][1].requestId);
    expect(sends[2][1].requestId).not.toBe(sends[0][1].requestId);
    expect(sends[2][1].resendOf).toBe(record.id);
    expect(localTextPackage).toHaveBeenCalledTimes(1);
  });
  it("an older in-flight status response cannot erase the review or re-enable delivery", async () => {
    const original = mock.request.getMockImplementation()!;
    let resolveStatus!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolveStatus = resolve;
    });
    mock.request.mockImplementation(
      async (action: string, ...args: unknown[]) =>
        action === "status"
          ? { ok: true, json: () => pending }
          : original(action, ...args),
    );
    render(<HarnessHandoff imageState={null} source={source} />);
    await prep();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I checked the outgoing/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open terminal review" }),
    );
    await screen.findByText(
      /Target: Codex terminal. Status: launch-requested-unconfirmed/,
    );
    await act(async () => {
      resolveStatus({ handoffs: [record] });
      await pending;
    });
    expect(
      screen.getByRole("button", { name: "Open terminal review" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("region", { name: "Outgoing handoff review" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Target: Codex terminal. Status: launch-requested-unconfirmed/,
      ),
    ).toBeInTheDocument();
  });
  it("stays truthful without the companion and makes no launcher request", async () => {
    mock.request.mockRejectedValue(Error("Static site"));
    render(<HarnessHandoff imageState={null} source={source} />);
    await waitFor(() => expect(mock.request).toHaveBeenCalled());
    expect(
      screen.getByText(/static site retains manual exports/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open terminal review" }),
    ).not.toBeInTheDocument();
  });
});

it("image task requires explicit outgoing confirmation and remains frozen after dispatch", async () => {
  const imageRecord = {
    ...record,
    sourceKind: "image",
    workflow: "canonical-image-reference-prompt",
  };
  const state: ImagePortalState = {
    ...createInitialImagePortalState(),
    builtOutput: {
      packageBytes: new Blob(["owned fixture zip"]),
      packageSha256: record.packageSha256,
      itemCount: 1,
    } as NonNullable<ImagePortalState["builtOutput"]>,
  };
  mock.request.mockImplementation(async (action: string) => ({
    ok: true,
    json: async () =>
      action === "capabilities"
        ? {
            kind: "reword-outbound-handoff",
            session: "a".repeat(64),
            terminalReviewAvailable: true,
            terminalTaskAvailable: true,
            version: "fixture",
            reason: "OFFLINE fixture only",
            location: "/owned",
            claude: { available: false, reason: "Unavailable" },
          }
        : action === "prepare"
          ? { handoff: imageRecord }
          : action === "dispatch"
            ? {
                handoff: {
                  ...imageRecord,
                  phase: "task-dispatch-claimed",
                  events: [{ file: "dispatch-intent.json" }],
                },
              }
            : { handoffs: [] },
  }));
  const view = render(<HarnessHandoff imageState={state} source={null} />);
  await screen.findByRole("combobox");
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I reviewed this source/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Review handoff" }));
  const start = await screen.findByRole("button", {
    name: "Start one Codex terminal task",
  });
  expect(start).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I checked the outgoing/ }),
  );
  expect(start).toBeEnabled();
  view.rerender(
    <HarnessHandoff
      imageState={{
        ...state,
        builtOutput: { ...state.builtOutput!, packageSha256: "e".repeat(64) },
      }}
      source={null}
    />,
  );
  expect(start).toBeDisabled();
  view.rerender(<HarnessHandoff imageState={state} source={null} />);
  fireEvent.click(start);
  await screen.findByText(
    /Target: Codex terminal. Status: task-dispatch-claimed/,
  );
  expect(start).toBeDisabled();
  fireEvent.click(start);
  expect(
    mock.request.mock.calls.filter((x) => x[0] === "dispatch"),
  ).toHaveLength(1);
  expect(document.querySelector(".handoff-outgoing pre")?.textContent).toBe(
    record.prompt,
  );
});
