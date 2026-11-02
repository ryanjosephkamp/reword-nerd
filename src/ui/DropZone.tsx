import { useState, type ReactNode } from "react";
import { readDrop, type Picked } from "./picked";

interface DropZoneProps {
  onPick: (picked: Picked) => void;
  children: ReactNode;
  className?: string;
  label: string;
}

/** Wraps an area so files and folders can be dropped anywhere on it. */
export function DropZone({ onPick, children, className = "", label }: DropZoneProps) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone ${over ? "dropzone-over" : ""} ${className}`}
      aria-label={label}
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes("Files")) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={async (event) => {
        if (![...event.dataTransfer.types].includes("Files")) return;
        event.preventDefault();
        setOver(false);
        onPick(await readDrop(event.dataTransfer));
      }}
    >
      {children}
    </div>
  );
}
