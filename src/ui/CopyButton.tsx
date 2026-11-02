import { Check, Copy } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

interface CopyButtonProps {
  /** The text to copy, or a function that builds it at click time. */
  text: string | (() => string);
  label?: string;
  className?: string;
  /** Runs after a successful copy, for example to open the destination. */
  onCopied?: () => void;
  disabled?: boolean;
}

export function CopyButton({
  text,
  label = "Copy",
  className = "btn",
  onCopied,
  disabled,
}: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
      setState("copied");
      onCopied?.();
    } catch {
      setState("failed");
    }
  }

  return (
    <button type="button" className={className} onClick={copy} disabled={disabled}>
      {state === "copied" ? <Check aria-hidden weight="bold" /> : <Copy aria-hidden />}
      <span>{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}</span>
    </button>
  );
}
