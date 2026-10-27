import { useEffect, useMemo, useState } from "react";
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
  const leaseInput = useMemo(() => ({
    enabled: input.enabled,
    occurrenceId: input.occurrenceId,
    sourceHash: input.sourceHash,
    purpose: input.purpose,
    sourceBytes: input.sourceBytes,
    registry,
  }), [input.enabled, input.occurrenceId, input.sourceHash, input.purpose, input.sourceBytes, registry]);
  const [snapshot, setSnapshot] = useState<Readonly<{ input: typeof leaseInput; url: string }> | null>(null);
  useEffect(() => {
    if (!leaseInput.enabled) return;
    let active = true;
    const lease = leaseInput.registry.acquire({
      occurrenceId: leaseInput.occurrenceId,
      sourceHash: leaseInput.sourceHash,
      purpose: leaseInput.purpose,
    }, leaseInput.sourceBytes);
    queueMicrotask(() => {
      if (active) setSnapshot({ input: leaseInput, url: lease.url });
    });
    return () => {
      active = false;
      lease.release();
    };
  }, [leaseInput]);
  // A resumed view must wait for its new lease instead of painting the revoked previous URL.
  return input.enabled && snapshot?.input === leaseInput ? snapshot.url : null;
}
