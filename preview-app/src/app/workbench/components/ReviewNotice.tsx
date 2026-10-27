import { WarningIcon } from "./Icons";

export function ReviewNotice({ visible }: { visible: boolean }) {
  return visible ? <p className="review-notice"><WarningIcon />Review extracted content before export</p> : null;
}
