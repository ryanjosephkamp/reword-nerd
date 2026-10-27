import { afterEach, describe, it, expect, vi } from "vitest";
import {
  isLocalCompanionOrigin,
  localRequest,
} from "../src/app/platform/localClient";
afterEach(() => vi.unstubAllGlobals());
describe("bounded local transport", () => {
  it("rejects public, HTTPS, named hosts and absent ports", () => {
    for (const l of [
      { protocol: "https:", hostname: "127.0.0.1", port: "5207" },
      { protocol: "http:", hostname: "localhost", port: "5207" },
      { protocol: "http:", hostname: "evil.test", port: "5207" },
      { protocol: "http:", hostname: "127.0.0.1", port: "" },
    ])
      expect(isLocalCompanionOrigin(l)).toBe(false);
  });
  it("cannot fetch from the static/public origin", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", {
      location: { protocol: "https:", hostname: "example.test", port: "" },
    });
    await expect(localRequest("capabilities")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("binds fixed endpoints and denies mutation without a launch token", async () => {
    const fetch = vi.fn().mockResolvedValue({});
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", {
      location: { protocol: "http:", hostname: "127.0.0.1", port: "5207" },
    });
    await expect(localRequest("run", "wrong")).rejects.toThrow();
    await expect(
      localRequest(
        "run",
        "a".repeat(64),
        new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]),
      ),
    ).rejects.toThrow();
    await localRequest("status");
    expect(fetch).toHaveBeenCalledWith(
      "/api/status",
      expect.objectContaining({
        mode: "same-origin",
        redirect: "error",
        credentials: "same-origin",
      }),
    );
  });
});
it("image preparation uses the fixed same-origin bounded upload, no arbitrary route", async () => {
  const fetch = vi.fn().mockResolvedValue({});
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("window", {
    location: { protocol: "http:", hostname: "127.0.0.1", port: "12345" },
  });
  await expect(
    localRequest("imagePrepare", "bad", new Blob(["fixture"])),
  ).rejects.toThrow();
  await expect(
    localRequest(
      "imagePrepare",
      "a".repeat(64),
      new Blob([new Uint8Array(24 * 1024 * 1024 + 1)]),
    ),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  const blob = new Blob(["fixture"]);
  await localRequest("imagePrepare", "a".repeat(64), blob);
  expect(fetch).toHaveBeenCalledWith(
    "/api/image/prepare",
    expect.objectContaining({
      method: "POST",
      mode: "same-origin",
      redirect: "error",
      body: blob,
    }),
  );
});
