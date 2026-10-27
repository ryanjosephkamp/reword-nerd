import { Blob as NativeBlob } from "node:buffer";

import {
  createImageIntakeCapacityCoordinator,
  type ImagePublicationAcknowledgement,
} from "../../src/image/intakeCapacity";
import type { ImageAdmission, ImageIntakeFailure } from "../../src/image/intakeContracts";

function admission(id: string, ordinal: number, byteCount: number, marker = id): ImageAdmission {
  const sourceBytes = new NativeBlob([new Uint8Array(byteCount).fill(marker.length)], { type: "image/png" }) as Blob;
  return {
    id,
    ordinal,
    sourceBytes,
    byteCount,
    sourceHash: `same-content-hash-${marker}`,
    mimeType: "image/png",
    fileExtension: "png",
    width: 1,
    height: 1,
    warnings: [],
    provenance: {
      intakeKind: "direct",
      sourceName: `${id}.png`,
      sourcePath: null,
      containerChain: [],
      containerName: null,
      containerHash: null,
      containerPath: null,
      pageNumber: null,
      relationshipId: null,
    },
  };
}

function accepted(id: string, epoch: number): ImagePublicationAcknowledgement {
  return { accepted: true, occurrenceId: id, sessionEpoch: epoch };
}

function issueCode(error: unknown): string | undefined {
  return (error as ImageIntakeFailure | undefined)?.issue?.code;
}

describe("Image intake capacity coordinator", () => {
  it("serializes intake and admits duplicate content as independent occurrences", async () => {
    // Catches overlapping extraction or hash-based deduplication deleting a real occurrence.
    let nextId = 0;
    let active = 0;
    let maximumActive = 0;
    const coordinator = createImageIntakeCapacityCoordinator({ idFactory: () => `occ-${++nextId}` });
    const published: ImageAdmission[] = [];
    const work = (marker: string) => coordinator.run(async ({ reserve, sessionEpoch }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      const lease = reserve(2);
      const result = lease.publish(
        (id, ordinal) => admission(id, ordinal, 2, marker),
        (item) => {
          published.push(item);
          return accepted(item.id, sessionEpoch);
        },
      );
      active -= 1;
      return result;
    });

    const [first, second] = await Promise.all([work("duplicate"), work("duplicate")]);
    expect(maximumActive).toBe(1);
    expect([first?.id, second?.id]).toEqual(["occ-1", "occ-2"]);
    expect(published.map(({ ordinal, sourceHash }) => ({ ordinal, sourceHash }))).toEqual([
      { ordinal: 0, sourceHash: "same-content-hash-duplicate" },
      { ordinal: 1, sourceHash: "same-content-hash-duplicate" },
    ]);
  });

  it("enforces count and byte boundaries against authoritative items plus unpublished leases", async () => {
    // Catches omitted or not-yet-reconciled images being omitted from the 100-image/100-MiB custody totals.
    const coordinator = createImageIntakeCapacityCoordinator({ idFactory: () => "new" });
    const held = Array.from({ length: 99 }, (_, index) => admission(`held-${index}`, index, 1));
    coordinator.reconcile(held);
    await coordinator.run(async ({ reserve }) => {
      const final = reserve(100 * 1024 * 1024 - 99);
      expect(() => reserve(1)).toThrowError();
      final.release();
    });

    await coordinator.run(async ({ reserve }) => {
      const countLease = reserve(1);
      expect(() => reserve(1)).toThrowError();
      countLease.release();
    });

    coordinator.reconcile([admission("large", 0, 100 * 1024 * 1024)]);
    await expect(coordinator.run(async ({ reserve }) => reserve(1))).rejects.toSatisfy(
      (error: unknown) => issueCode(error) === "SESSION_BYTES_EXCEEDED",
    );
  });

  it("does not consume public IDs or ordinals for validation failures or rejected and throwing dispatches", async () => {
    // Catches phantom identity/capacity after a candidate fails before acknowledged reducer publication.
    let idCalls = 0;
    const coordinator = createImageIntakeCapacityCoordinator({ idFactory: () => `occ-${++idCalls}` });
    await coordinator.run(async ({ reserve }) => {
      reserve(2).release();
    });
    expect(idCalls).toBe(0);

    const rejected = await coordinator.run(async ({ reserve, sessionEpoch }) => reserve(2).publish(
      (id, ordinal) => admission(id, ordinal, 2),
      (item) => ({ accepted: false, occurrenceId: item.id, sessionEpoch }),
    ));
    expect(rejected).toBeNull();

    await expect(coordinator.run(async ({ reserve }) => reserve(2).publish(
      (id, ordinal) => admission(id, ordinal, 2),
      () => { throw new Error("dispatch failed"); },
    ))).rejects.toThrow("dispatch failed");

    const current = await coordinator.run(async ({ reserve, sessionEpoch }) => reserve(2).publish(
      (id, ordinal) => admission(id, ordinal, 2),
      (item) => accepted(item.id, sessionEpoch),
    ));
    expect(current).toMatchObject({ id: "occ-1", ordinal: 0 });
    expect(idCalls).toBe(1);
    expect(coordinator.snapshot()).toEqual({ count: 1, bytes: 2, sessionEpoch: 0 });
  });

  it("rejects synchronous nested publication before it can share an ordinal or allocate an ID", async () => {
    // Catches a reentrant reducer callback publishing two candidates with the same public order/identity slot.
    let idCalls = 0;
    const coordinator = createImageIntakeCapacityCoordinator({ idFactory: () => `occ-${++idCalls}` });
    let nestedIssue: string | undefined;
    const published = await coordinator.run(async ({ reserve, sessionEpoch }) => {
      const outer = reserve(1);
      const inner = reserve(1);
      return outer.publish(
        (id, ordinal) => admission(id, ordinal, 1),
        (item) => {
          try {
            inner.publish(
              (id, ordinal) => admission(id, ordinal, 1),
              (candidate) => accepted(candidate.id, sessionEpoch),
            );
          } catch (error) {
            nestedIssue = issueCode(error);
          }
          return accepted(item.id, sessionEpoch);
        },
      );
    });
    expect(published).toMatchObject({ id: "occ-1", ordinal: 0 });
    expect(nestedIssue).toBe("PUBLICATION_REENTRANT");
    expect(idCalls).toBe(1);
  });

  it("queues synchronous reentrant reconciliation until publication acknowledgement", async () => {
    // Catches reducer sync double-charging bytes or deleting a lease while its dispatch is still on the stack.
    const coordinator = createImageIntakeCapacityCoordinator({ idFactory: () => "reentrant" });
    const item = await coordinator.run(async ({ reserve, sessionEpoch }) => reserve(7).publish(
      (id, ordinal) => admission(id, ordinal, 7),
      (candidate) => {
        coordinator.reconcile([candidate]);
        expect(coordinator.snapshot()).toEqual({ count: 1, bytes: 7, sessionEpoch: 0 });
        return accepted(candidate.id, sessionEpoch);
      },
    ));
    expect(item?.id).toBe("reentrant");
    expect(coordinator.snapshot()).toEqual({ count: 1, bytes: 7, sessionEpoch: 0 });

    coordinator.reconcile([]);
    expect(coordinator.snapshot()).toEqual({ count: 0, bytes: 0, sessionEpoch: 0 });
  });

  it("retains an acknowledged lease until the exact occurrence is authoritative", async () => {
    // Catches an acknowledgement briefly releasing capacity before React/reducer state publishes the occurrence.
    const coordinator = createImageIntakeCapacityCoordinator({ idFactory: () => "pending" });
    const item = await coordinator.run(async ({ reserve, sessionEpoch }) => reserve(11).publish(
      (id, ordinal) => admission(id, ordinal, 11),
      (candidate) => accepted(candidate.id, sessionEpoch),
    ));
    expect(coordinator.snapshot()).toEqual({ count: 1, bytes: 11, sessionEpoch: 0 });

    coordinator.reconcile([admission("unrelated", 9, 3)]);
    expect(coordinator.snapshot()).toEqual({ count: 2, bytes: 14, sessionEpoch: 0 });
    coordinator.reconcile([admission("unrelated", 9, 3), item!]);
    expect(coordinator.snapshot()).toEqual({ count: 2, bytes: 14, sessionEpoch: 0 });
  });

  it("aborts and suppresses stale reset-overlapped completion without orphan capacity", async () => {
    // Catches a pre-reset async candidate resurrecting bytes or consuming identity in the next session.
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    let idCalls = 0;
    const coordinator = createImageIntakeCapacityCoordinator({ idFactory: () => `occ-${++idCalls}` });
    const old = coordinator.run(async ({ reserve, signal, sessionEpoch }) => {
      const lease = reserve(8);
      await oldGate;
      expect(signal.aborted).toBe(true);
      return lease.publish(
        (id, ordinal) => admission(id, ordinal, 8),
        (item) => accepted(item.id, sessionEpoch),
      );
    });
    await Promise.resolve();
    coordinator.reset();
    releaseOld();
    await expect(old).rejects.toSatisfy((error: unknown) => issueCode(error) === "STALE_SESSION");
    expect(idCalls).toBe(0);
    expect(coordinator.snapshot()).toEqual({ count: 0, bytes: 0, sessionEpoch: 1 });

    const fresh = await coordinator.run(async ({ reserve, sessionEpoch }) => reserve(1).publish(
      (id, ordinal) => admission(id, ordinal, 1),
      (item) => accepted(item.id, sessionEpoch),
    ));
    expect(fresh).toMatchObject({ id: "occ-1", ordinal: 0 });
  });
});
