import { ObjectUrlRegistry } from "../../src/app/workbench/objectUrlRegistry";

describe("ObjectUrlRegistry", () => {
  it("creates lazily, reference-counts subscribers, and revokes only the final release", () => {
    // This catches duplicate URLs, early revocation, and object URLs leaking after the final preview closes.
    const create = vi.fn(() => "blob:local-preview");
    const revoke = vi.fn();
    const registry = new ObjectUrlRegistry(create, revoke);
    expect(create).not.toHaveBeenCalled();

    const first = registry.acquire("asset-hash", new Uint8Array([1]), "image/png");
    const second = registry.acquire("asset-hash", new Uint8Array([1]), "image/png");
    expect(create).toHaveBeenCalledOnce();
    expect(first.url).toBe(second.url);

    first.release();
    expect(revoke).not.toHaveBeenCalled();
    second.release();
    second.release();
    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:local-preview");
  });
});
