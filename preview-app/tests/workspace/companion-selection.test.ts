import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../src/app/platform/localClient", () => ({ isLocalCompanionOrigin: () => true }));
import { DeviceWorkspaceStore } from "../../src/workspace/companionStore";
afterEach(() => vi.unstubAllGlobals());
it("does not silently choose browser storage when companion discovery fails", async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError("Owned connection failure")); vi.stubGlobal("fetch", fetch);
  await expect(new DeviceWorkspaceStore().read()).rejects.toThrow(/companion.*unavailable/i);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("retains the explicit dev-server fallback for an absent workspace endpoint", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404 }));
  await expect(new DeviceWorkspaceStore().read()).rejects.toThrow(/Browser storage is unavailable/);
});
