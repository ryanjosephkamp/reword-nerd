import type { ImagePortalItem } from "./contracts";
import {
  MAX_IMAGE_SESSION_BYTES,
  MAX_IMAGE_SESSION_COUNT,
  failImageIntake,
  type ImageAdmission,
} from "./intakeContracts";

export interface ImagePublicationAcknowledgement {
  readonly accepted: boolean;
  readonly occurrenceId: string;
  readonly sessionEpoch: number;
}

export interface ImageCapacitySnapshot {
  readonly count: number;
  readonly bytes: number;
  readonly sessionEpoch: number;
}

export interface ImageCapacityLease {
  publish(
    build: (occurrenceId: string, ordinal: number) => ImageAdmission,
    dispatch: (admission: ImageAdmission) => ImagePublicationAcknowledgement,
  ): ImageAdmission | null;
  release(): void;
}

export interface ImageIntakeCapacityScope {
  readonly sessionEpoch: number;
  readonly signal: AbortSignal;
  reserve(byteCount: number): ImageCapacityLease;
}

export interface ImageIntakeCapacityCoordinator {
  run<T>(operation: (scope: ImageIntakeCapacityScope) => Promise<T>): Promise<T>;
  reconcile(items: readonly Pick<ImagePortalItem | ImageAdmission, "id" | "sourceBytes">[]): void;
  reset(): void;
  snapshot(): ImageCapacitySnapshot;
}

export interface ImageIntakeCapacityOptions {
  readonly idFactory: () => string;
}

interface CapacityLeaseRecord {
  readonly token: number;
  readonly epoch: number;
  readonly byteCount: number;
  state: "reserved" | "published" | "released";
  occurrenceId: string | null;
}

function authoritativeCopy(
  items: readonly Pick<ImagePortalItem | ImageAdmission, "id" | "sourceBytes">[],
): Map<string, number> {
  const result = new Map<string, number>();
  for (const item of items) {
    if (!item.id || !Number.isSafeInteger(item.sourceBytes.size) || item.sourceBytes.size < 1) continue;
    result.set(item.id, item.sourceBytes.size);
  }
  return result;
}

export function createImageIntakeCapacityCoordinator(
  options: ImageIntakeCapacityOptions,
): ImageIntakeCapacityCoordinator {
  let authoritative = new Map<string, number>();
  const leases = new Map<number, CapacityLeaseRecord>();
  let nextLeaseToken = 1;
  let nextOrdinal = 0;
  let sessionEpoch = 0;
  let abortController = new AbortController();
  let queue: Promise<unknown> = Promise.resolve();
  let publicationDepth = 0;
  let queuedAuthoritative: Map<string, number> | null = null;
  let reusableOccurrenceIds: string[] = [];

  const reconcileNow = (next: Map<string, number>) => {
    authoritative = next;
    for (const [token, lease] of leases) {
      if (lease.state === "published"
        && lease.occurrenceId !== null
        && authoritative.has(lease.occurrenceId)) {
        leases.delete(token);
      }
    }
  };

  const currentTotals = (): { count: number; bytes: number } => {
    let count = authoritative.size;
    let bytes = 0;
    for (const size of authoritative.values()) bytes += size;
    for (const lease of leases.values()) {
      if (lease.state === "released") continue;
      if (lease.state === "published"
        && lease.occurrenceId !== null
        && authoritative.has(lease.occurrenceId)) continue;
      count += 1;
      bytes += lease.byteCount;
    }
    return { count, bytes };
  };

  const releaseLease = (lease: CapacityLeaseRecord) => {
    if (lease.state !== "reserved") return;
    lease.state = "released";
    if (leases.get(lease.token) === lease) leases.delete(lease.token);
  };

  const coordinator: ImageIntakeCapacityCoordinator = {
    run<T>(operation: (scope: ImageIntakeCapacityScope) => Promise<T>): Promise<T> {
      const requestedEpoch = sessionEpoch;
      const requestedSignal = abortController.signal;
      const result = queue.then(async () => {
        if (requestedEpoch !== sessionEpoch || requestedSignal.aborted) failImageIntake("STALE_SESSION");
        const owned = new Set<CapacityLeaseRecord>();
        const scope: ImageIntakeCapacityScope = {
          sessionEpoch: requestedEpoch,
          signal: requestedSignal,
          reserve(byteCount) {
            if (requestedEpoch !== sessionEpoch || requestedSignal.aborted) failImageIntake("STALE_SESSION");
            if (!Number.isSafeInteger(byteCount) || byteCount < 1) failImageIntake("INPUT_SIZE_INVALID");
            const totals = currentTotals();
            if (totals.count + 1 > MAX_IMAGE_SESSION_COUNT) failImageIntake("SESSION_COUNT_EXCEEDED");
            if (totals.bytes + byteCount > MAX_IMAGE_SESSION_BYTES) failImageIntake("SESSION_BYTES_EXCEEDED");
            const lease: CapacityLeaseRecord = {
              token: nextLeaseToken++,
              epoch: requestedEpoch,
              byteCount,
              state: "reserved",
              occurrenceId: null,
            };
            leases.set(lease.token, lease);
            owned.add(lease);
            return {
              publish(build, dispatch) {
                if (lease.state !== "reserved" || leases.get(lease.token) !== lease) {
                  failImageIntake("STALE_SESSION");
                }
                if (requestedEpoch !== sessionEpoch || requestedSignal.aborted) {
                  releaseLease(lease);
                  failImageIntake("STALE_SESSION");
                }
                if (publicationDepth > 0) {
                  releaseLease(lease);
                  failImageIntake("PUBLICATION_REENTRANT");
                }
                const occurrenceId = reusableOccurrenceIds.shift() ?? options.idFactory();
                let idRecycled = false;
                const recycleId = () => {
                  if (idRecycled) return;
                  idRecycled = true;
                  reusableOccurrenceIds.unshift(occurrenceId);
                };
                if (!occurrenceId) {
                  releaseLease(lease);
                  failImageIntake("READ_FAILED");
                }
                const ordinal = nextOrdinal;
                let admission: ImageAdmission;
                try {
                  admission = build(occurrenceId, ordinal);
                } catch (error) {
                  recycleId();
                  releaseLease(lease);
                  throw error;
                }
                if (admission.id !== occurrenceId
                  || admission.ordinal !== ordinal
                  || admission.byteCount !== lease.byteCount
                  || admission.sourceBytes.size !== lease.byteCount) {
                  recycleId();
                  releaseLease(lease);
                  failImageIntake("READ_FAILED");
                }
                publicationDepth += 1;
                try {
                  const acknowledgement = dispatch(admission);
                  const accepted = acknowledgement.accepted
                    && acknowledgement.sessionEpoch === requestedEpoch
                    && acknowledgement.occurrenceId === occurrenceId
                    && requestedEpoch === sessionEpoch
                    && !requestedSignal.aborted;
                  if (!accepted) {
                    recycleId();
                    releaseLease(lease);
                    return null;
                  }
                  lease.state = "published";
                  lease.occurrenceId = occurrenceId;
                  nextOrdinal += 1;
                  return admission;
                } catch (error) {
                  recycleId();
                  releaseLease(lease);
                  throw error;
                } finally {
                  publicationDepth -= 1;
                  if (publicationDepth === 0 && queuedAuthoritative) {
                    const queued = queuedAuthoritative;
                    queuedAuthoritative = null;
                    reconcileNow(queued);
                  }
                }
              },
              release() {
                releaseLease(lease);
              },
            };
          },
        };
        try {
          const value = await operation(scope);
          if (requestedEpoch !== sessionEpoch || requestedSignal.aborted) failImageIntake("STALE_SESSION");
          return value;
        } finally {
          for (const lease of owned) releaseLease(lease);
        }
      });
      queue = result.catch(() => undefined);
      return result;
    },
    reconcile(items) {
      const next = authoritativeCopy(items);
      if (publicationDepth > 0) queuedAuthoritative = next;
      else reconcileNow(next);
    },
    reset() {
      sessionEpoch += 1;
      abortController.abort();
      abortController = new AbortController();
      authoritative = new Map();
      queuedAuthoritative = null;
      leases.clear();
      nextOrdinal = 0;
      reusableOccurrenceIds = [];
    },
    snapshot() {
      return { ...currentTotals(), sessionEpoch };
    },
  };
  return coordinator;
}
