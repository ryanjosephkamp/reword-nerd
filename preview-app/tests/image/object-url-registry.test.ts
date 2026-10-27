import { Blob as NativeBlob } from "node:buffer";

import { ImageObjectUrlRegistry } from "../../src/image/objectUrlRegistry";

describe("Image object URL registry", () => {
  it("creates lazily and reference-counts an occurrence/source/purpose lease", () => {
    // Catches duplicate URLs or early revocation while two preview consumers share one occurrence view.
    const create = vi.fn(() => "blob:first");
    const revoke = vi.fn();
    const registry = new ImageObjectUrlRegistry(create, revoke);
    const blob = new NativeBlob([new Uint8Array([1])], { type: "image/png" }) as Blob;

    const first = registry.acquire({ occurrenceId: "a", sourceHash: "hash", purpose: "thumbnail" }, blob);
    const second = registry.acquire({ occurrenceId: "a", sourceHash: "hash", purpose: "thumbnail" }, blob);
    expect(create).toHaveBeenCalledOnce();
    expect(first.url).toBe(second.url);
    first.release();
    expect(revoke).not.toHaveBeenCalled();
    second.release();
    second.release();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:first");
  });

  it("keeps duplicate occurrences, source revisions, and purposes independent", () => {
    // Catches content hashes collapsing duplicate queue items or a thumbnail revoking the focused preview.
    let sequence = 0;
    const revoke = vi.fn();
    const registry = new ImageObjectUrlRegistry(() => `blob:${++sequence}`, revoke);
    const blob = new NativeBlob([new Uint8Array([1])], { type: "image/png" }) as Blob;
    const leases = [
      registry.acquire({ occurrenceId: "a", sourceHash: "same", purpose: "thumbnail" }, blob),
      registry.acquire({ occurrenceId: "b", sourceHash: "same", purpose: "thumbnail" }, blob),
      registry.acquire({ occurrenceId: "a", sourceHash: "same", purpose: "focused" }, blob),
      registry.acquire({ occurrenceId: "a", sourceHash: "replacement", purpose: "thumbnail" }, blob),
    ];
    expect(leases.map((lease) => lease.url)).toEqual(["blob:1", "blob:2", "blob:3", "blob:4"]);

    registry.disposeOccurrence("a");
    expect(revoke.mock.calls.map(([url]) => url).sort()).toEqual(["blob:1", "blob:3", "blob:4"]);
    leases[1].release();
    expect(revoke).toHaveBeenCalledWith("blob:2");
  });

  it("disposes every live URL idempotently for reset, navigation, or unmount", () => {
    // Catches session-level cleanup leaving any Image-owned object URL alive.
    let sequence = 0;
    const revoke = vi.fn();
    const registry = new ImageObjectUrlRegistry(() => `blob:${++sequence}`, revoke);
    const blob = new NativeBlob([new Uint8Array([1])], { type: "image/png" }) as Blob;
    registry.acquire({ occurrenceId: "a", sourceHash: "1", purpose: "thumbnail" }, blob);
    registry.acquire({ occurrenceId: "b", sourceHash: "2", purpose: "focused" }, blob);
    registry.disposeAll();
    registry.disposeAll();
    expect(revoke.mock.calls.map(([url]) => url).sort()).toEqual(["blob:1", "blob:2"]);
  });
});
