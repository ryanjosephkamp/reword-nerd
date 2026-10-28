import { X } from "@phosphor-icons/react";
import { useEffect } from "react";
import { useWorkspace, type Notice } from "../store";

function NoticeItem({ notice }: { notice: Notice }) {
  const dismiss = useWorkspace((state) => state.dismissNotice);
  useEffect(() => {
    if (notice.tone === "error") return;
    const timer = setTimeout(() => dismiss(notice.id), 4000);
    return () => clearTimeout(timer);
  }, [notice, dismiss]);
  return (
    <div
      className={`notice notice-${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      <span>{notice.text}</span>
      <button
        type="button"
        className="btn-icon"
        aria-label="Dismiss"
        onClick={() => dismiss(notice.id)}
      >
        <X aria-hidden />
      </button>
    </div>
  );
}

export function Notices() {
  const notices = useWorkspace((state) => state.notices);
  return (
    <div className="notices" aria-live="polite">
      {notices.map((notice) => (
        <NoticeItem key={notice.id} notice={notice} />
      ))}
    </div>
  );
}
