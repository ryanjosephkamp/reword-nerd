import { isLocalCompanionOrigin } from "./localClient";
import { COLLECTION_LIMITS } from "../../collections/limits";
export async function collectionRequest(action: "capabilities" | "status" | "catalog" | "prepare" | "dispatch" | "cancel", session?: string, payload = "{}") {
  if (!isLocalCompanionOrigin(window.location)) throw Error("Use the companion's own local UI for execution");
  if (!["capabilities","status","catalog","prepare","dispatch","cancel"].includes(action)) throw Error("Unknown collection action");
  const mutation = !["capabilities", "status"].includes(action);
  if (mutation && !/^[a-f0-9]{64}$/.test(session ?? "")) throw Error("Invalid local session");
  if (new TextEncoder().encode(payload).length > (action === "prepare" ? COLLECTION_LIMITS.transportBytes : 4096)) throw Error("Collection request exceeds bounds");
  const response = await fetch(`/api/collections/${action}`, { method: mutation ? "POST" : "GET", mode: "same-origin", credentials: "same-origin", redirect: "error", headers: mutation ? {"content-type":"application/json","x-reword-session":session!} : {}, ...(mutation ? {body:payload} : {}) });
  const data: unknown = await response.json();
  if (!response.ok) throw Error((data as {error?:string})?.error ?? "Collection request failed");
  return data;
}
