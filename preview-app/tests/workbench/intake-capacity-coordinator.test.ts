import { describe, expect, it } from "vitest";

import { createIntakeCapacityCoordinator } from "../../src/app/workbench/intakeCapacityCoordinator";

describe("intake admission custody", () => {
  it("retains a committed item when later work in the same operation fails", async () => {
    // This catches a dispatched ZIP losing identity, bytes, and ordinal custody when later document preflight rejects.
    const coordinator = createIntakeCapacityCoordinator();
    const failing = coordinator.run(async (_capacity, reservations) => {
      const zip = reservations.reserveItem({
        id: "zip-a",
        projectTreeHash: "tree-zip-a",
        acceptedCount: 0,
        acceptedBytes: 60,
      });
      expect(zip).not.toBeNull();
      if (zip === null) throw new Error("reservation missing");
      zip.commit();
      throw new Error("document preflight failed");
    });

    await expect(failing).rejects.toThrow("document preflight failed");
    const later = await coordinator.run(async (capacity, reservations) => {
      const duplicate = reservations.reserveItem({
        id: "zip-copy",
        projectTreeHash: "tree-zip-a",
        acceptedCount: 0,
        acceptedBytes: 60,
      });
      const distinct = reservations.reserveItem({
        id: "folder-b",
        projectTreeHash: "tree-folder-b",
        acceptedCount: 0,
        acceptedBytes: 40,
      });
      return {
        value: {
          capacity,
          duplicate,
          distinctOrdinal: distinct?.uploadOrdinal ?? null,
        },
        acceptedCount: 0,
        acceptedBytes: 40,
      };
    });

    expect(later).toEqual({
      capacity: { acceptedCount: 0, acceptedBytes: 60 },
      duplicate: null,
      distinctOrdinal: 1,
    });
  });

  it("releases an uncommitted item when its operation settles", async () => {
    // This catches a reservation that was never dispatched becoming phantom identity or capacity custody.
    const coordinator = createIntakeCapacityCoordinator();
    await coordinator.run(async (_capacity, reservations) => ({
      value: reservations.reserveItem({ id: "not-dispatched", acceptedCount: 1, acceptedBytes: 10 }),
      acceptedCount: 1,
      acceptedBytes: 10,
    }));

    const later = await coordinator.run(async (capacity, reservations) => {
      const reused = reservations.reserveItem({ id: "not-dispatched", acceptedCount: 1, acceptedBytes: 10 });
      return {
        value: { capacity, ordinal: reused?.uploadOrdinal ?? null },
        acceptedCount: 1,
        acceptedBytes: 10,
      };
    });
    expect(later).toEqual({ capacity: { acceptedCount: 0, acceptedBytes: 0 }, ordinal: 0 });
  });

  it("releases all uncommitted items when their operation fails", async () => {
    // This catches a wholly unpublished failed batch leaving any ID, tree, bytes, count, or ordinal reserved.
    const coordinator = createIntakeCapacityCoordinator();
    const failing = coordinator.run(async (_capacity, reservations) => {
      reservations.reserveItem({ id: "document-a", acceptedCount: 1, acceptedBytes: 10 });
      reservations.reserveItem({ id: "project-a", projectTreeHash: "tree-a", acceptedCount: 0, acceptedBytes: 20 });
      throw new Error("batch failed before dispatch");
    });
    await expect(failing).rejects.toThrow("batch failed before dispatch");

    const later = await coordinator.run(async (capacity, reservations) => {
      const document = reservations.reserveItem({ id: "document-a", acceptedCount: 1, acceptedBytes: 10 });
      const project = reservations.reserveItem({ id: "project-copy", projectTreeHash: "tree-a", acceptedCount: 0, acceptedBytes: 20 });
      return {
        value: {
          capacity,
          documentOrdinal: document?.uploadOrdinal ?? null,
          projectOrdinal: project?.uploadOrdinal ?? null,
        },
        acceptedCount: 1,
        acceptedBytes: 30,
      };
    });
    expect(later).toEqual({
      capacity: { acceptedCount: 0, acceptedBytes: 0 },
      documentOrdinal: 0,
      projectOrdinal: 1,
    });
  });

  it("releases a committed item when its dispatch is explicitly rejected", async () => {
    // This catches reducer rejection leaving committed identity and capacity behind without an authoritative item.
    const coordinator = createIntakeCapacityCoordinator();
    await coordinator.run(async (_capacity, reservations) => {
      const rejected = reservations.reserveItem({ id: "rejected", acceptedCount: 1, acceptedBytes: 10 });
      expect(rejected).not.toBeNull();
      if (rejected === null) throw new Error("reservation missing");
      rejected.commit();
      rejected.release();
      return { value: undefined, acceptedCount: 0, acceptedBytes: 0 };
    });

    const later = await coordinator.run(async (capacity, reservations) => {
      const reused = reservations.reserveItem({ id: "rejected", acceptedCount: 1, acceptedBytes: 10 });
      return {
        value: { capacity, ordinal: reused?.uploadOrdinal ?? null },
        acceptedCount: 1,
        acceptedBytes: 10,
      };
    });
    expect(later).toEqual({ capacity: { acceptedCount: 0, acceptedBytes: 0 }, ordinal: 0 });
  });

  it("does not let an old reset-overlapped operation release a new reservation", async () => {
    // This catches a pre-reset failure deleting same-ID custody acquired by the fresh session.
    const coordinator = createIntakeCapacityCoordinator();
    let rejectOld!: (reason: Error) => void;
    const oldGate = new Promise<never>((_resolve, reject) => { rejectOld = reject; });
    const old = coordinator.run(async (_capacity, reservations) => {
      const stale = reservations.reserveItem({ id: "same-id", acceptedCount: 1, acceptedBytes: 10 });
      expect(stale).not.toBeNull();
      if (stale === null) throw new Error("reservation missing");
      stale.commit();
      return oldGate;
    });
    await Promise.resolve();

    coordinator.reset();
    const fresh = await coordinator.run(async (_capacity, reservations) => {
      const current = reservations.reserveItem({ id: "same-id", acceptedCount: 1, acceptedBytes: 20 });
      expect(current).not.toBeNull();
      if (current === null) throw new Error("reservation missing");
      current.commit();
      return { value: current.uploadOrdinal, acceptedCount: 1, acceptedBytes: 20 };
    });
    expect(fresh).toBe(0);

    rejectOld(new Error("stale operation failed"));
    await expect(old).rejects.toThrow("stale operation failed");
    const later = await coordinator.run(async (capacity, reservations) => ({
      value: {
        capacity,
        duplicate: reservations.reserveItem({ id: "same-id", acceptedCount: 1, acceptedBytes: 20 }),
      },
      acceptedCount: 0,
      acceptedBytes: 0,
    }));
    expect(later).toEqual({ capacity: { acceptedCount: 1, acceptedBytes: 20 }, duplicate: null });
  });

  it("reserves global monotonic ordinals atomically without charging duplicate IDs or project trees", async () => {
    // This catches concurrent document/project hooks independently issuing ordinal zero or charging duplicates.
    const coordinator = createIntakeCapacityCoordinator();
    const admitted = await coordinator.run(async (_capacity, reservations) => {
      const first = reservations.reserveItem({ id: "folder-a", projectTreeHash: "tree-a", acceptedCount: 0, acceptedBytes: 1 });
      const duplicateTree = reservations.reserveItem({ id: "folder-copy", projectTreeHash: "tree-a", acceptedCount: 0, acceptedBytes: 1 });
      const duplicateId = reservations.reserveItem({ id: "folder-a", projectTreeHash: "tree-b", acceptedCount: 0, acceptedBytes: 1 });
      const document = reservations.reserveItem({ id: "document-a", acceptedCount: 1, acceptedBytes: 1 });
      first?.commit();
      document?.commit();
      return {
        value: {
          first: first?.uploadOrdinal ?? null,
          duplicateTree,
          duplicateId,
          document: document?.uploadOrdinal ?? null,
        },
        acceptedCount: 2,
        acceptedBytes: 2,
      };
    });

    expect(admitted).toEqual({ first: 0, duplicateTree: null, duplicateId: null, document: 1 });
    const later = await coordinator.run(async (_capacity, reservations) => {
      const reservation = reservations.reserveItem({ id: "later", acceptedCount: 1, acceptedBytes: 1 });
      return { value: reservation?.uploadOrdinal ?? null, acceptedCount: 1, acceptedBytes: 1 };
    });
    expect(later).toBe(2);
  });

  it("synchronizes removals and resets identity and ordinal custody", async () => {
    // This catches a removed item remaining blocked or a new session inheriting the prior ordinal sequence.
    const coordinator = createIntakeCapacityCoordinator();
    coordinator.syncItems([{ id: "held", uploadOrdinal: 4, projectTreeHash: "tree-held" }]);
    const next = await coordinator.run(async (_capacity, reservations) => {
      const reservation = reservations.reserveItem({ id: "next", acceptedCount: 1, acceptedBytes: 1 });
      reservation?.commit();
      return { value: reservation?.uploadOrdinal ?? null, acceptedCount: 1, acceptedBytes: 1 };
    });
    expect(next).toBe(5);
    coordinator.syncItems([
      { id: "held", uploadOrdinal: 4, projectTreeHash: "tree-held" },
      { id: "next", uploadOrdinal: 5 },
    ]);
    coordinator.syncItems([]);
    const held = await coordinator.run(async (_capacity, reservations) => {
      const reservation = reservations.reserveItem({ id: "held", projectTreeHash: "tree-held", acceptedCount: 0, acceptedBytes: 1 });
      return { value: reservation?.uploadOrdinal ?? null, acceptedCount: 0, acceptedBytes: 1 };
    });
    expect(held).toBe(0);
    coordinator.reset();
    const fresh = await coordinator.run(async (_capacity, reservations) => {
      const reservation = reservations.reserveItem({ id: "fresh", acceptedCount: 1, acceptedBytes: 1 });
      return { value: reservation?.uploadOrdinal ?? null, acceptedCount: 1, acceptedBytes: 1 };
    });
    expect(fresh).toBe(0);
  });

  it("reconciles an active removal after the pending operation fails", async () => {
    // This catches max-only active sync retaining removed bytes, IDs, and tree hashes after a failed read.
    const coordinator = createIntakeCapacityCoordinator();
    coordinator.sync({ acceptedCount: 0, acceptedBytes: 60 });
    coordinator.syncItems([{ id: "held", uploadOrdinal: 0, projectTreeHash: "tree-held" }]);
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let rejectPending!: (reason: Error) => void;
    const gate = new Promise<never>((_resolve, reject) => { rejectPending = reject; });
    const pending = coordinator.run(async (capacity) => {
      expect(capacity).toEqual({ acceptedCount: 0, acceptedBytes: 60 });
      markStarted();
      return gate;
    });

    await started;
    const rejected = expect(pending).rejects.toThrow("reader failed");
    coordinator.sync({ acceptedCount: 0, acceptedBytes: 0 });
    coordinator.syncItems([]);
    rejectPending(new Error("reader failed"));
    await rejected;

    const reusable = await coordinator.run(async (capacity, reservations) => {
      const reservation = reservations.reserveItem({ id: "held", projectTreeHash: "tree-held", acceptedCount: 0, acceptedBytes: 10 });
      return {
        value: { capacity, ordinal: reservation?.uploadOrdinal ?? null },
        acceptedCount: 0,
        acceptedBytes: 10,
      };
    });
    expect(reusable).toEqual({ capacity: { acceptedCount: 0, acceptedBytes: 0 }, ordinal: 0 });
  });

  it("reconciles removal after a duplicate settles without releasing a queued reservation", async () => {
    // This catches settlement clearing all custody or retaining the removed authoritative item instead of only the live reservation.
    const coordinator = createIntakeCapacityCoordinator();
    coordinator.sync({ acceptedCount: 0, acceptedBytes: 60 });
    coordinator.syncItems([{ id: "held", uploadOrdinal: 0, projectTreeHash: "tree-held" }]);
    let markReserved!: () => void;
    const reservationStarted = new Promise<void>((resolve) => { markReserved = resolve; });
    let releaseReserved!: () => void;
    const reservedGate = new Promise<void>((resolve) => { releaseReserved = resolve; });
    const reserved = coordinator.run(async (_capacity, reservations) => {
      const reservation = reservations.reserveItem({ id: "queued", projectTreeHash: "tree-queued", acceptedCount: 0, acceptedBytes: 20 });
      reservation?.commit();
      markReserved();
      await reservedGate;
      return { value: reservation?.uploadOrdinal ?? null, acceptedCount: 0, acceptedBytes: 20 };
    });
    const duplicate = coordinator.run(async (capacity, reservations) => {
      const reservation = reservations.reserveItem({ id: "queued-copy", projectTreeHash: "tree-queued", acceptedCount: 0, acceptedBytes: 20 });
      return {
        value: { capacity, ordinal: reservation?.uploadOrdinal ?? null },
        acceptedCount: 0,
        acceptedBytes: 0,
      };
    });

    await reservationStarted;
    coordinator.sync({ acceptedCount: 0, acceptedBytes: 0 });
    coordinator.syncItems([]);
    releaseReserved();
    expect(await reserved).toBe(1);
    expect(await duplicate).toEqual({ capacity: { acceptedCount: 0, acceptedBytes: 20 }, ordinal: null });

    const reused = await coordinator.run(async (capacity, reservations) => {
      const held = reservations.reserveItem({ id: "held", projectTreeHash: "tree-held", acceptedCount: 0, acceptedBytes: 10 });
      const queuedDuplicate = reservations.reserveItem({ id: "queued-again", projectTreeHash: "tree-queued", acceptedCount: 0, acceptedBytes: 10 });
      return {
        value: {
          capacity,
          heldOrdinal: held?.uploadOrdinal ?? null,
          queuedDuplicate: queuedDuplicate?.uploadOrdinal ?? null,
        },
        acceptedCount: 0,
        acceptedBytes: 10,
      };
    });
    expect(reused).toEqual({
      capacity: { acceptedCount: 0, acceptedBytes: 20 },
      heldOrdinal: 2,
      queuedDuplicate: null,
    });
  });
});
