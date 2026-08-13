import type { PreflightCapacity } from "../../domain";

interface CoordinatedAdmission<T> {
  value: T;
  acceptedCount: number;
  acceptedBytes: number;
}

export type IntakeCapacity = Required<PreflightCapacity>;

export interface IntakeCapacityCoordinator {
  run<T>(operation: (capacity: IntakeCapacity) => Promise<CoordinatedAdmission<T>>): Promise<T>;
  sync(capacity: PreflightCapacity): void;
  reset(): void;
}

export function createIntakeCapacityCoordinator(): IntakeCapacityCoordinator {
  let capacity: IntakeCapacity = { acceptedCount: 0, acceptedBytes: 0 };
  let queue: Promise<unknown> = Promise.resolve();
  let generation = 0;
  let active = 0;

  return {
    run<T>(operation: (snapshot: IntakeCapacity) => Promise<CoordinatedAdmission<T>>) {
      const operationGeneration = generation;
      active += 1;
      const result = queue.then(async () => {
        if (operationGeneration !== generation) throw new Error("STALE_INTAKE_OPERATION");
        const snapshot = { ...capacity };
        const admitted = await operation(snapshot);
        if (operationGeneration !== generation) throw new Error("STALE_INTAKE_OPERATION");
        capacity = {
          acceptedCount: Math.max(capacity.acceptedCount, snapshot.acceptedCount + admitted.acceptedCount),
          acceptedBytes: Math.max(capacity.acceptedBytes, snapshot.acceptedBytes + admitted.acceptedBytes),
        };
        return admitted.value;
      });
      queue = result.catch(() => undefined).finally(() => {
        if (operationGeneration === generation) active = Math.max(0, active - 1);
      });
      return result;
    },
    sync(next) {
      const normalized: IntakeCapacity = {
        acceptedCount: next.acceptedCount ?? 0,
        acceptedBytes: next.acceptedBytes ?? 0,
      };
      capacity = active > 0 ? {
        acceptedCount: Math.max(capacity.acceptedCount, normalized.acceptedCount),
        acceptedBytes: Math.max(capacity.acceptedBytes, normalized.acceptedBytes),
      } : normalized;
    },
    reset() {
      generation += 1;
      active = 0;
      capacity = { acceptedCount: 0, acceptedBytes: 0 };
      queue = Promise.resolve();
    },
  };
}
