import { afterEach, describe, expect, it, vi } from "vitest";
import { handoffRequest } from "../src/app/platform/handoffClient";
afterEach(() => vi.unstubAllGlobals());
describe("same-origin outbound client", () => {
  it("rejects public origins without probing a daemon", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(handoffRequest("capabilities")).rejects.toThrow(/origin/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("validates operation, session, IDs and bounds before fetch", async () => {
    vi.stubGlobal("window", {
      location: { protocol: "http:", hostname: "127.0.0.1", port: "5555" },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response("{}"),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      handoffRequest("prepare", {
        session: "a".repeat(64),
        kind: "image",
        requestId: "../x",
      }),
    ).rejects.toThrow(/identity/);
    await expect(handoffRequest("open", { session: "bad" })).rejects.toThrow(
      /session/,
    );
    await expect(
      handoffRequest("open", {
        session: "a".repeat(64),
        body: new Blob(["x".repeat(4097)]),
      }),
    ).rejects.toThrow(/limit/);
    await expect(
      handoffRequest("dispatch", { session: "bad" }),
    ).rejects.toThrow(/session/);
    await expect(
      handoffRequest("dispatch", {
        session: "a".repeat(64),
        body: new Blob(["x".repeat(4097)]),
      }),
    ).rejects.toThrow(/limit/);
    expect(fetch).not.toHaveBeenCalled();
    await handoffRequest("prepare", {
      session: "a".repeat(64),
      kind: "image",
      requestId: "7b6e74b4-dc18-42f5-ad41-df823710acee",
      body: new Blob(["zip"]),
    });
    expect(fetch.mock.calls[0][0]).toContain("/api/handoff/prepare?");
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      mode: "same-origin",
      redirect: "error",
    });
  });
});
