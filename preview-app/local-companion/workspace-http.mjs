import { join } from "node:path";
import { createWorkspaceStore } from "./workspace-store.mjs";
const MAX_BYTES = 512 * 1024 * 1024;
export async function createWorkspaceRoute(root, validate) {
  const store = await createWorkspaceStore(join(root, "workspace-snapshots"), { validate });
  let writing = false;
  async function meta(session) { const m = await store.metadata(); return { kind: "reword-workspace-store", version: 1, session, revision: m.revision, enabled: m.enabled, savedAt: m.savedAt, hasFile: m.slot !== null, hasPrevious: m.previousSlot !== null }; }
  return async (req, res, url, token, send) => {
    if (!url.pathname.startsWith("/api/workspace/")) return false;
    if (url.search) throw Error("Workspace endpoints do not accept query parameters.");
    const action = url.pathname.slice("/api/workspace/".length);
    if (req.method === "GET" && action === "meta") { send(200, await meta(token)); return true; }
    if (req.method === "GET" && ["file", "previous"].includes(action)) {
      const m = await store.metadata(), file = await store.file(action === "file" ? m.slot : m.previousSlot);
      if (!file) { send(404, { error: "No saved workspace copy." }); return true; }
      res.writeHead(200, { "content-type": "application/x-reword-nerd-workspace", "content-disposition": 'attachment; filename="reword-nerd-workspace.rn-workspace"', "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(Buffer.from(await file.arrayBuffer())); return true;
    }
    if (req.method !== "POST" || !["save", "enable", "forget"].includes(action)) { send(404, { error: "Unknown workspace endpoint." }); return true; }
    if (writing) throw Error("A workspace write is already active. The confirmed copy is unchanged.");
    const revision = req.headers["x-reword-revision"];
    if (typeof revision !== "string" || !/^(0|[1-9]\d{0,14})$/.test(revision)) throw Error("Invalid workspace revision.");
    const limit = action === "save" ? MAX_BYTES : 64;
    if (Number(req.headers["content-length"] ?? 0) > limit) throw Error("Workspace request exceeds byte limit.");
    if (req.headers["content-type"] !== (action === "save" ? "application/x-reword-nerd-workspace" : "application/json")) throw Error("Unsupported workspace content type.");
    writing = true;
    try {
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > limit) throw Error("Workspace request exceeds byte limit."); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks);
      if (action === "save") await store.save(new Blob([bytes]), Number(revision));
      else {
        const body = JSON.parse(bytes.toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("Invalid workspace action.");
        if (action === "enable") { if (Object.keys(body).join(",") !== "enabled" || typeof body.enabled !== "boolean") throw Error("Invalid workspace preference."); await store.enable(body.enabled, Number(revision)); }
        else { if (Object.keys(body).length) throw Error("Unexpected workspace-clear parameters."); await store.forget(Number(revision)); }
      }
      send(200, await meta(token)); return true;
    } finally { writing = false; }
  };
}
