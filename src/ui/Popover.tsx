import { useEffect, useId, useRef, useState, type ReactNode } from "react";

const supported = typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;

interface PopoverProps {
  /** The button's content. */
  trigger: ReactNode;
  /** Names the button (when its content is an icon) and the panel. */
  label: string;
  buttonClassName?: string;
  className?: string;
  /** Given a function that closes the panel, for menus whose items should close it. */
  children: (close: () => void) => ReactNode;
}

/** A button that opens a small panel below it. Escape and outside clicks close it. */
export function Popover({
  trigger,
  label,
  buttonClassName = "btn",
  className = "",
  children,
}: PopoverProps) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [fallbackOpen, setFallbackOpen] = useState(false);

  // Right-aligned under the button. Placed before it shows, then nudged in if it overflows.
  const place = () => {
    const anchor = button.current?.getBoundingClientRect();
    const element = panel.current;
    if (!anchor || !element) return;
    element.style.top = `${Math.round(anchor.bottom + 6)}px`;
    element.style.left = "auto";
    element.style.right = `${Math.round(Math.max(8, window.innerWidth - anchor.right))}px`;
  };
  const keepInView = () => {
    const element = panel.current;
    if (element && element.getBoundingClientRect().left < 8) {
      element.style.left = "8px";
      element.style.right = "auto";
    }
  };

  useEffect(() => {
    const element = panel.current;
    if (!element || !supported) return;
    const opening = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") place();
    };
    const toggled = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") {
        keepInView();
        element.querySelector<HTMLElement>("input:checked, button, input")?.focus();
      } else if (element.contains(document.activeElement)) {
        button.current?.focus();
      }
    };
    element.addEventListener("beforetoggle", opening);
    element.addEventListener("toggle", toggled);
    return () => {
      element.removeEventListener("beforetoggle", opening);
      element.removeEventListener("toggle", toggled);
    };
  }, []);

  useEffect(() => {
    if (supported || !fallbackOpen) return;
    place();
    keepInView();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) {
        setFallbackOpen(false);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFallbackOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [fallbackOpen]);

  const close = () => {
    if (supported) document.getElementById(id)?.hidePopover();
    else setFallbackOpen(false);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={buttonClassName}
        aria-label={typeof trigger === "string" ? undefined : label}
        {...(supported
          ? { popoverTarget: id }
          : {
              "aria-expanded": fallbackOpen,
              "aria-controls": id,
              onClick: () => setFallbackOpen((open) => !open),
            })}
      >
        {trigger}
      </button>
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-label={label}
        className={`popover ${className}`}
        {...(supported ? { popover: "auto" as const } : { hidden: !fallbackOpen })}
      >
        {children(close)}
      </div>
    </>
  );
}
