import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return document.scrollingElement as HTMLElement | null;
}

/** A textarea that grows to fit its text, so the page scrolls instead of the box. */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      // Shrinking to measure would scroll the page; remember where it was.
      const scroller = scrollParent(element);
      const top = scroller?.scrollTop ?? 0;
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight + 2}px`;
      if (scroller) scroller.scrollTop = top;
    };
    fit();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) {
        width = element.clientWidth;
        fit();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.value]);

  return <textarea ref={ref} {...props} />;
}
