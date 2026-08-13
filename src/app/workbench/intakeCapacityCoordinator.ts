import type { PreflightCapacity } from "../../domain";

interface CoordinatedAdmission<T> {
  value: T;
  acceptedCount: number;
  acceptedBytes: number;
}

export type IntakeCapacity = Required<PreflightCapacity>;

export interface IntakeItemIdentity {
  id: string;
  uploadOrdinal?: number;
  projectTreeHash?: string;
}

export interface IntakeItemReservation extends IntakeItemIdentity {
  acceptedCount: number;
  acceptedBytes: number;
}

export interface IntakeReservationLease {
  readonly uploadOrdinal: number;
  commit(): void;
  release(): void;
}

export interface IntakeReservationScope {
  reserveItem(identity: IntakeItemReservation): IntakeReservationLease | null;
}

export interface IntakeCapacityCoordinator {
  run<T>(operation: (capacity: IntakeCapacity, reservations: IntakeReservationScope) => Promise<CoordinatedAdmission<T>>): Promise<T>;
  sync(capacity: PreflightCapacity): void;
  syncItems(items: readonly IntakeItemIdentity[]): void;
  reset(): void;
}

export function createIntakeCapacityCoordinator(): IntakeCapacityCoordinator {
  type ReservedItem = IntakeItemReservation & {
    uploadOrdinal: number;
    committed: boolean;
  };

  let authoritativeCapacity: IntakeCapacity = { acceptedCount: 0, acceptedBytes: 0 };
  let authoritativeItems: IntakeItemIdentity[] = [];
  const reservedItems = new Map<string, ReservedItem>();
  let queue: Promise<unknown> = Promise.resolve();
  let generation = 0;

  const isAuthoritative = (reservation: ReservedItem) => authoritativeItems.some((item) => item.id === reservation.id
    || (reservation.projectTreeHash !== undefined && item.projectTreeHash === reservation.projectTreeHash));
  const reconcilePublishedReservations = () => {
    for (const [id, reservation] of reservedItems) {
      if (isAuthoritative(reservation)) reservedItems.delete(id);
    }
  };
  const snapshotCapacity = (): IntakeCapacity => {
    let acceptedCount = authoritativeCapacity.acceptedCount;
    let acceptedBytes = authoritativeCapacity.acceptedBytes;
    for (const reservation of reservedItems.values()) {
      acceptedCount += reservation.acceptedCount;
      acceptedBytes += reservation.acceptedBytes;
    }
    return { acceptedCount, acceptedBytes };
  };
  const nextUploadOrdinal = () => {
    let next = 0;
    for (const item of authoritativeItems) next = Math.max(next, (item.uploadOrdinal ?? -1) + 1);
    for (const reservation of reservedItems.values()) next = Math.max(next, reservation.uploadOrdinal + 1);
    return next;
  };

  return {
    run<T>(operation: (snapshot: IntakeCapacity, reservations: IntakeReservationScope) => Promise<CoordinatedAdmission<T>>) {
      const operationGeneration = generation;
      const result = queue.then(async () => {
        if (operationGeneration !== generation) throw new Error("STALE_INTAKE_OPERATION");
        const ownedReservations = new Set<ReservedItem>();
        const reservationScope: IntakeReservationScope = {
          reserveItem(identity) {
            if (operationGeneration !== generation) return null;
            reconcilePublishedReservations();
            const conflicts = authoritativeItems.some((item) => item.id === identity.id
              || (identity.projectTreeHash !== undefined && item.projectTreeHash === identity.projectTreeHash))
              || Array.from(reservedItems.values()).some((item) => item.id === identity.id
                || (identity.projectTreeHash !== undefined && item.projectTreeHash === identity.projectTreeHash));
            if (conflicts) return null;
            const uploadOrdinal = nextUploadOrdinal();
            const reservation: ReservedItem = {
              ...identity,
              uploadOrdinal,
              committed: false,
            };
            reservedItems.set(identity.id, reservation);
            ownedReservations.add(reservation);
            return {
              uploadOrdinal,
              commit() {
                if (reservedItems.get(identity.id) === reservation) reservation.committed = true;
              },
              release() {
                if (reservedItems.get(identity.id) === reservation) reservedItems.delete(identity.id);
              },
            };
          },
        };
        try {
          const admitted = await operation(snapshotCapacity(), reservationScope);
          if (operationGeneration !== generation) throw new Error("STALE_INTAKE_OPERATION");
          return admitted.value;
        } finally {
          for (const reservation of ownedReservations) {
            if (!reservation.committed && reservedItems.get(reservation.id) === reservation) {
              reservedItems.delete(reservation.id);
            }
          }
          reconcilePublishedReservations();
        }
      });
      queue = result.catch(() => undefined);
      return result;
    },
    sync(next) {
      authoritativeCapacity = {
        acceptedCount: next.acceptedCount ?? 0,
        acceptedBytes: next.acceptedBytes ?? 0,
      };
    },
    syncItems(items) {
      authoritativeItems = items.map((item) => ({ ...item }));
      reconcilePublishedReservations();
    },
    reset() {
      generation += 1;
      authoritativeCapacity = { acceptedCount: 0, acceptedBytes: 0 };
      authoritativeItems = [];
      reservedItems.clear();
      queue = Promise.resolve();
    },
  };
}
