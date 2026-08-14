import { useEffect, useState } from "react";
import type { ImageObjectUrlPurpose, ImageObjectUrlRegistry } from "../objectUrlRegistry";

export interface UseImageObjectUrlInput {
  readonly occurrenceId: string;
  readonly sourceHash: string;
  readonly purpose: ImageObjectUrlPurpose;
  readonly sourceBytes: Blob;
  readonly enabled: boolean;
}

export function useImageObjectUrl(
  registry: ImageObjectUrlRegistry,
  input: UseImageObjectUrlInput,
): string | null {
  const leaseKey = `${input.occurrenceId}\u0000${input.sourceHash}\u0000${input.purpose}`;
  const [snapshot, setSnapshot] = useState<Readonly<{ key: string; url: string }> | null>(null);
  useEffect(() => {
    if (!input.enabled) return;
    let active = true;
    const lease = registry.acquire({
      occurrenceId: input.occurrenceId,
      sourceHash: input.sourceHash,
      purpose: input.purpose,
    }, input.sourceBytes);
    queueMicrotask(() => {
      if (active) setSnapshot({ key: leaseKey, url: lease.url });
    });
    return () => {
      active = false;
      lease.release();
    };
  }, [
    input.enabled,
    input.occurrenceId,
    input.purpose,
    input.sourceBytes,
    input.sourceHash,
    leaseKey,
    registry,
  ]);
  return input.enabled && snapshot?.key === leaseKey ? snapshot.url : null;
}
