const LOCAL_ENDPOINTS = Object.freeze({
  capabilities: "/api/capabilities",
  status: "/api/status",
  run: "/api/run",
  cancel: "/api/cancel",
  resume: "/api/resume",
  imageCapabilities: "/api/image/capabilities",
  imageStatus: "/api/image/status",
  imagePrepare: "/api/image/prepare",
});
export type LocalAction = keyof typeof LOCAL_ENDPOINTS;
export function isLocalCompanionOrigin(
  location: Pick<Location, "protocol" | "hostname" | "port">,
): boolean {
  return (
    location.protocol === "http:" &&
    location.hostname === "127.0.0.1" &&
    /^\d{1,5}$/.test(location.port)
  );
}
export function localRequest(
  action: LocalAction,
  session?: string,
  body?: Blob,
): Promise<Response> {
  if (
    !isLocalCompanionOrigin(window.location) ||
    !Object.hasOwn(LOCAL_ENDPOINTS, action)
  )
    return Promise.reject(new Error("Local companion origin required"));
  const mutation = ![
    "capabilities",
    "status",
    "imageCapabilities",
    "imageStatus",
  ].includes(action);
  if (mutation && !/^[a-f0-9]{64}$/.test(session ?? ""))
    return Promise.reject(new Error("Invalid launch session"));
  if (
    body &&
    ((action !== "run" && action !== "imagePrepare") ||
      body.size > (action === "imagePrepare" ? 24 : 8) * 1024 * 1024)
  )
    return Promise.reject(new Error("Unsupported local payload"));
  return fetch(LOCAL_ENDPOINTS[action], {
    method: mutation ? "POST" : "GET",
    mode: "same-origin",
    credentials: "same-origin",
    redirect: "error",
    headers: mutation
      ? {
          "x-reword-session": session!,
          ...(body ? { "content-type": "application/zip" } : {}),
        }
      : {},
    body,
  });
}

const HANDOFF_ENDPOINTS = Object.freeze({
  capabilities: "/api/handoff/capabilities",
  status: "/api/handoff/status",
  prepare: "/api/handoff/prepare",
  open: "/api/handoff/open",
  dispatch: "/api/handoff/dispatch",
});
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export async function handoffRequest(
  action: "capabilities" | "status" | "prepare" | "open" | "dispatch",
  options: {
    session?: string;
    body?: Blob;
    kind?: "text" | "image";
    requestId?: string;
    resendOf?: string;
  } = {},
) {
  if (!isLocalCompanionOrigin(window.location))
    throw Error("Local companion origin required");
  if (
    !["capabilities", "status", "prepare", "open", "dispatch"].includes(action)
  )
    throw Error("Unknown handoff action");
  const mutation =
    action === "prepare" || action === "open" || action === "dispatch";
  if (mutation && !/^[a-f0-9]{64}$/.test(options.session ?? ""))
    throw Error("Invalid local session");
  const query = new URLSearchParams();
  if (action === "prepare") {
    if (
      !["text", "image"].includes(options.kind ?? "") ||
      !uuid.test(options.requestId ?? "") ||
      (options.resendOf && !uuid.test(options.resendOf))
    )
      throw Error("Invalid handoff identity");
    query.set("kind", options.kind!);
    query.set("requestId", options.requestId!);
    if (options.resendOf) query.set("resendOf", options.resendOf);
  }
  const max =
    action === "open" || action === "dispatch"
      ? 4096
      : (options.kind === "image" ? 24 : 8) * 1024 * 1024;
  if (options.body && options.body.size > max)
    throw Error("Handoff input exceeds limit");
  return fetch(
    HANDOFF_ENDPOINTS[action] + (query.size ? "?" + query.toString() : ""),
    {
      method: mutation ? "POST" : "GET",
      mode: "same-origin",
      credentials: "same-origin",
      redirect: "error",
      headers: mutation
        ? {
            "x-reword-session": options.session!,
            "content-type":
              action === "open" || action === "dispatch"
                ? "application/json"
                : "application/zip",
          }
        : {},
      body: options.body,
    },
  );
}
