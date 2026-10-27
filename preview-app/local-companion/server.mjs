import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  mkdir,
  appendFile,
  readFile,
  writeFile,
  rename,
  lstat,
  unlink,
  rmdir,
} from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { Host } from "./host.mjs";
import { createHandoffService } from "./handoff/service.mjs";
import { createImagePreparation } from "./image-preparation.mjs";
import { createCollectionService } from "./collections/service.mjs";
import { parseStrictJson } from "../src/collections/strictJson.ts";
import { COLLECTION_LIMITS } from "../src/collections/limits.ts";
import { loadPackage } from "../companion/package.ts";
import {
  prepareJob,
  getStatus,
  nextStage,
  recordResponse,
  exportJob,
} from "../companion/runner.ts";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const MAX_BODY = 8 * 1024 * 1024;
const artifacts = [
  "final.md",
  "source.md",
  "workbook-progress.html",
  "review.html",
  "verification-response.txt",
  "decompose-response.txt",
  "rewrite-response.txt",
  "verify-response.txt",
  "final-response.txt",
  "execution-receipt.json",
  "SHA256SUMS.txt",
  "connection-audit.json",
];
export function checkRequest(req, authority, token, mutation = false) {
  if (req.headers.host !== authority) throw Error("Invalid Host");
  if (req.headers.origin && req.headers.origin !== `http://${authority}`)
    throw Error("Cross-origin request denied");
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw Error("Cross-site request denied");
  if (
    mutation &&
    (req.headers.origin !== `http://${authority}` ||
      req.headers["x-reword-session"] !== token)
  )
    throw Error("Invalid local session");
}
async function boundedFile(path, max = 16 * 1024 * 1024) {
  const st = await lstat(path);
  if (!st.isFile() || st.isSymbolicLink() || st.size > max)
    throw Error("Unsafe/oversized artifact");
  return readFile(path);
}
export async function createService({
  root,
  dist,
  port = 0,
  hostFactory = Host.open,
  live = false,
  handoffReviewer = null,
  terminalRunner = null,
  terminalEnabled = false,
  terminalRepeatable = false,
  terminalTestBudget = false,
  handoffTerminalCheck,
  handoffOpenTerminal,
  collectionOptions = {},
}) {
  root = resolve(root);
  dist = resolve(dist);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw Error("Unsafe state directory");
  const lockPath = join(root, "service-lock.json");
  const lockBytes = JSON.stringify({
    kind: "reword-local-service-lock",
    version: 1,
    pid: process.pid,
    nonce: randomBytes(16).toString("hex"),
  });
  try {
    await writeFile(lockPath, lockBytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const recovery = join(root, "service-lock-recovery");
    try {
      await mkdir(recovery, { mode: 0o700 });
    } catch (guardError) {
      throw Error(
        "State lock recovery is already owned; inspect an interrupted guard",
        { cause: guardError },
      );
    }
    try {
      const prior = await boundedFile(lockPath, 4096);
      const lock = JSON.parse(prior.toString());
      if (
        lock.kind !== "reword-local-service-lock" ||
        lock.version !== 1 ||
        !Number.isInteger(lock.pid) ||
        lock.pid < 1
      )
        throw Error("Unrecognized state lock; inspect it manually", {
          cause: error,
        });
      let dead = false;
      try {
        process.kill(lock.pid, 0);
      } catch (e) {
        if (e.code === "ESRCH") dead = true;
        else throw e;
      }
      if (!dead)
        throw Error("This state directory already has a live owner", {
          cause: error,
        });
      if (!prior.equals(await boundedFile(lockPath, 4096)))
        throw Error("State lock changed", { cause: error });
      await unlink(lockPath);
      await writeFile(lockPath, lockBytes, { flag: "wx", mode: 0o600 });
    } finally {
      await rmdir(recovery);
    }
  }
  const release = async () => {
    try {
      if ((await boundedFile(lockPath, 4096)).toString() === lockBytes)
        await unlink(lockPath);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  };
  try {
    const token = randomBytes(32).toString("hex");
    const handoffs = await createHandoffService(join(root, "handoffs"), {
      reviewer: handoffReviewer,
      terminalRunner,
      terminalEnabled,
      terminalRepeatable,
      terminalTestBudget,
      terminalCheck: handoffTerminalCheck,
      openTerminal: handoffOpenTerminal,
    });
    const imagePreparation = await createImagePreparation(join(root, "image"));
    let execution = null;
    let authority,
      host,
      capabilities = null,
      busy = false,
      controller = null,
      state = null;
    const statePath = join(root, "connection.json");
    try {
      state = JSON.parse((await boundedFile(statePath, 256 * 1024)).toString());
      if (
        state.kind !== "reword-local-text-job" ||
        !/^[-a-f0-9]{36}$/.test(state.id) ||
        state.schemaVersion !== 1
      )
        throw Error("Invalid persisted connection identity");
      if (state.status === "running") state.status = "interrupted";
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const save = async () => {
      await writeFile(statePath + ".next", JSON.stringify(state, null, 2), {
        mode: 0o600,
      });
      await rename(statePath + ".next", statePath);
    };
    const jobRoot = () => join(root, "job");
    if (state) {
      if (
        ![
          "prepared",
          "interrupted",
          "running",
          "failed",
          "cancelled",
          "awaiting-user-review",
        ].includes(state.status) ||
        state.modelTurns !== state.dispatches?.length ||
        state.dispatches.some(
          (x, i) =>
            x.stage !== ["decompose", "rewrite", "verify", "final"][i] ||
            x.sourceSha256 !== state.sourceSha256 ||
            x.packageSha256 !== state.packageSha256,
        )
      )
        throw Error("Persisted dispatch binding mismatch");
      const existing = await getStatus(jobRoot());
      if (
        state.runnerJobId !== existing.jobId ||
        state.sourceSha256 !== existing.sourceSha256 ||
        state.packageSha256 !== existing.packageSha256 ||
        state.documentKey !== existing.documentKey ||
        !Number.isInteger(state.modelTurns) ||
        state.modelTurns < 0 ||
        state.modelTurns > 4 ||
        !Array.isArray(state.dispatches)
      )
        throw Error("Persisted job binding mismatch");
    }
    if (state && !live) capabilities = state.executor;
    const collections = await createCollectionService(join(root, "collections"), {
      ...collectionOptions,
      hostFactory: collectionOptions.hostFactory ?? hostFactory,
      legacyBlocked: async () => Boolean(busy || (state?.modelTurns && !state.exported)) ||
        (await handoffs.list()).some(h => h.events.some(e => ["dispatch-intent.json", "start-requested.json"].includes(e.file)) && h.phase !== "task-ended-review-pending"),
    });
    async function connect() {
      host = await hostFactory(root);
      try {
        capabilities = await host.discover();
        if (state?.requestedRuntime && host.selectRuntime) host.selectRuntime(state.requestedRuntime);
        return capabilities;
      } catch (e) {
        host.close();
        throw e;
      }
    }
    async function publicStatus() {
      return state
        ? {
            ...state,
            location: root,
            runner: await getStatus(jobRoot()),
            artifacts: state.exported
              ? [
                  ...artifacts,
                  "package.zip",
                  ...state.dispatches
                    .filter((x) => x.rawSha256)
                    .map((x) => x.stage + "-raw.json"),
                ]
              : [],
            final: state.exported
              ? (
                  await boundedFile(
                    join(root, "review", "final.md"),
                    1024 * 1024,
                  )
                ).toString("utf8")
              : null,
          }
        : null;
    }
    async function execute() {
      if (busy) throw Error("One active job only");
      busy = true;
      controller = new AbortController();
      state.status = "running";
      await save();
      try {
        if (!host || host.closed) await connect();
        for (let i = 0; i < 4; i++) {
          if (controller.signal.aborted) throw Error("Cancelled");
          const next = await nextStage(jobRoot());
          if (next.complete) break;
          const ticket = next.ticket,
            stage = ticket.stage;
          state.stage = stage;
          await save();
          const prefix = join(root, stage + "-" + ticket.ticketId);
          const prior = state.dispatches.find(
            (x) => x.ticketId === ticket.ticketId,
          );
          if (prior) {
            if (!prior.rawSha256)
              throw Error(
                "Interrupted dispatched stage has uncertain output; no automatic retry is authorized",
              );
            const raw = await boundedFile(
              prefix + "-response.txt",
              1024 * 1024,
            );
            if (
              hash(raw) !== prior.rawSha256 ||
              hash(await boundedFile(prefix + "-raw.json")) !==
                prior.rawEnvelopeSha256 ||
              prior.promptSha256 !== ticket.promptSha256
            )
              throw Error("Retained response binding mismatch");
            await recordResponse(
              jobRoot(),
              next.ticketPath,
              prefix + "-response.txt",
            );
            continue;
          }
          if (state.modelTurns >= 4)
            throw Error("Four-stage request cap reached");
          const prompt = (
            await boundedFile(next.promptPath, 2 * 1024 * 1024)
          ).toString("utf8");
          if (hash(prompt) !== ticket.promptSha256)
            throw Error("Prepared prompt hash mismatch");
          await host.run(root, prompt, {
            signal: controller.signal,
            onRawEvent: async (event) => {
              await appendFile(
                prefix + "-stream.jsonl",
                JSON.stringify(event) + "\n",
                { mode: 0o600 },
              );
            },
            onDispatched: async ({ threadId }) => {
              if (state.cancelled) throw Error("Cancelled before dispatch");
              state.modelTurns++;
              state.dispatches.push({
                ticketId: ticket.ticketId,
                promptSha256: ticket.promptSha256,
                sourceSha256: ticket.sourceSha256,
                packageSha256: ticket.packageSha256,
                stage,
                threadId,
                at: new Date().toISOString(),
              });
              await save();
            },
            onRaw: async (result) => {
              // Preserve raw message envelope and exact text before recording against runner state.
              await writeFile(
                prefix + "-raw.json",
                JSON.stringify(result, null, 2),
                { flag: "wx", mode: 0o600 },
              );
              await writeFile(prefix + "-response.txt", result.text, {
                flag: "wx",
                mode: 0o600,
              });
              const entry = state.dispatches.find(
                (x) => x.ticketId === ticket.ticketId,
              );
              entry.rawSha256 = hash(result.text);
              entry.rawEnvelopeSha256 = hash(
                await readFile(prefix + "-raw.json"),
              );
              entry.turnId = result.completion.turnId;
              await save();
            },
          });
          if (controller.signal.aborted)
            throw Error(
              "Cancelled; retained raw output is not automatically applied",
            );
          await recordResponse(
            jobRoot(),
            next.ticketPath,
            prefix + "-response.txt",
          );
        }
        const status = await getStatus(jobRoot());
        if (!status.complete) throw Error("Incomplete stage sequence");
        await exportJob(jobRoot(), join(root, "review"));
        state.status = "awaiting-user-review";
        state.exported = true;
        state.acceptedByUser = false;
        await save();
        await writeFile(
          join(root, "review", "connection-audit.json"),
          JSON.stringify(state, null, 2),
          { flag: "wx", mode: 0o600 },
        );
      } catch (error) {
        state.status = controller.signal.aborted ? "cancelled" : "failed";
        state.error = error.message;
        await save();
      } finally {
        host?.close();
        host = null;
        controller = null;
        busy = false;
      }
    }
    const server = createServer(async (req, res) => {
      const send = (status, value) => {
        res.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        res.end(JSON.stringify(value));
      };
      try {
        checkRequest(req, authority, token, req.method !== "GET");
        const url = new URL(req.url, `http://${authority}`),
          path = url.pathname;
        if (path.startsWith("/api/")) {
          if (path.startsWith("/api/collections/")) {
            if (url.search) throw Error("Collection endpoints do not accept query parameters");
            if (req.method === "GET" && path === "/api/collections/capabilities") return send(200, { ...await collections.capabilities(), session: token });
            if (req.method === "GET" && path === "/api/collections/status") return send(200, { records: await collections.list() });
            if (req.method === "POST") {
              if (req.headers["content-type"] !== "application/json") throw Error("Expected collection JSON");
              const chunks = []; let length = 0;
              const limit = path === "/api/collections/prepare" ? COLLECTION_LIMITS.transportBytes : 4096;
              for await (const chunk of req) { length += chunk.length; if (length > limit) throw Error("Collection request exceeds byte limit"); chunks.push(chunk); }
              const bytes = Buffer.concat(chunks);
              if (path === "/api/collections/prepare") return send(200, await collections.prepare(bytes));
              const body = parseStrictJson(bytes.toString("utf8"));
              if (path === "/api/collections/dispatch") {
                if (!body || Object.keys(body).sort().join(",") !== "id,seal") throw Error("Invalid collection dispatch identity");
                return send(202, await collections.dispatch(body.id, body.seal));
              }
              if (!body || Object.keys(body).length) throw Error("Unexpected collection action parameters");
              if (path === "/api/collections/catalog") return send(200, { catalog: await collections.refreshCatalog() });
              if (path === "/api/collections/cancel") return send(202, collections.cancel());
            }
            const match = path.match(/^\/api\/collections\/artifact\/([a-f0-9-]+)\/([a-z0-9.-]+)$/);
            if (req.method === "GET" && match) {
              const bytes = await collections.artifact(match[1], match[2]);
              res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${match[2]}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" });
              return res.end(bytes);
            }
            return send(404, {error:"Unknown collection endpoint"});
          }
          if (req.method === "GET" && path === "/api/handoff/capabilities")
            return send(200, {
              ...(await handoffs.discover()),
              session: token,
            });
          if (req.method === "GET" && path === "/api/handoff/status")
            return send(200, { handoffs: await handoffs.list() });
          if (req.method === "POST" && path === "/api/handoff/prepare") {
            if (req.headers["content-type"] !== "application/zip")
              throw Error("Expected a reviewed package");
            if (
              [...url.searchParams.keys()].some(
                (k) => !["kind", "requestId", "resendOf"].includes(k),
              ) ||
              [...url.searchParams.keys()].some(
                (k) => url.searchParams.getAll(k).length !== 1,
              )
            )
              throw Error("Invalid handoff query");
            const kind = url.searchParams.get("kind"),
              limit = (kind === "image" ? 24 : 8) * 1024 * 1024;
            const chunks = [];
            let bytes = 0;
            for await (const part of req) {
              bytes += part.length;
              if (bytes > limit) throw Error("Handoff package exceeds limit");
              chunks.push(part);
            }
            return send(200, {
              handoff: await handoffs.prepare(Buffer.concat(chunks), kind, {
                requestId: url.searchParams.get("requestId"),
                resendOf: url.searchParams.get("resendOf"),
              }),
            });
          }
          if (
            req.method === "POST" &&
            ["/api/handoff/open", "/api/handoff/dispatch"].includes(path)
          ) {
            if (collectionOptions.textEnabled || collectionOptions.imageEnabled) throw Error("New execution uses the reviewed collection flow; earlier records remain readable");
            if (await collections.blocked(false)) throw Error("An active or uncertain collection blocks legacy starts");
            if (req.headers["content-type"] !== "application/json")
              throw Error("Expected handoff identity");
            const chunks = [];
            let size = 0;
            for await (const part of req) {
              size += part.length;
              if (size > 4096) throw Error("Oversized handoff identity");
              chunks.push(part);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString());
            if (Object.keys(body).sort().join(",") !== "id,snapshotSha256")
              throw Error("Invalid handoff fields");
            return send(200, {
              handoff: await (
                path.endsWith("/dispatch") ? handoffs.dispatch : handoffs.launch
              )(body.id, body.snapshotSha256),
            });
          }
          const handoffArtifact = path.match(
            /^\/api\/handoff\/artifact\/([a-f0-9-]+)\/([a-z.-]+)$/,
          );
          if (req.method === "GET" && handoffArtifact) {
            const bytes = await handoffs.artifact(
              handoffArtifact[1],
              handoffArtifact[2],
            );
            res.writeHead(200, {
              "content-type": "application/octet-stream",
              "content-disposition": `attachment; filename="${handoffArtifact[2]}"`,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            });
            return res.end(bytes);
          }

          if (req.method === "GET" && path === "/api/image/capabilities")
            return send(200, {
              ...imagePreparation.capabilities,
              session: token,
              location: join(root, "image"),
            });
          if (req.method === "GET" && path === "/api/image/status")
            return send(200, { job: await imagePreparation.snapshot() });
          if (req.method === "POST" && path === "/api/image/prepare") {
            if (req.headers["content-type"] !== "application/zip")
              throw Error("Expected an image package ZIP");
            let n = 0;
            const chunks = [];
            for await (const chunk of req) {
              n += chunk.length;
              if (n > 24 * 1024 * 1024)
                throw Error("Image package exceeds 24 MiB");
              chunks.push(chunk);
            }
            return send(
              200,
              await imagePreparation.prepare(Buffer.concat(chunks)),
            );
          }
          const imageArtifact = path.match(
            /^\/api\/image\/artifact\/([a-z.-]+)$/,
          );
          if (req.method === "GET" && imageArtifact) {
            const bytes = await imagePreparation.artifact(imageArtifact[1]);
            res.writeHead(200, {
              "content-type": "application/octet-stream",
              "content-disposition": `attachment; filename="${imageArtifact[1]}"`,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            });
            return res.end(bytes);
          }

          if (req.method === "GET" && path === "/api/capabilities")
            return send(200, {
              available: Boolean(capabilities) && live,
              capabilities,
              session: token,
              location: root,
              mode: live ? "execution" : "review-only",
            });
          if (req.method === "GET" && path === "/api/status")
            return send(200, { job: await publicStatus() });
          if (req.method === "POST" && path === "/api/run") {
            if (collectionOptions.textEnabled || collectionOptions.imageEnabled) throw Error("New execution uses the reviewed collection flow; earlier records remain readable");
            if (await collections.blocked(false)) throw Error("An active or uncertain collection blocks legacy starts");
            if (!live || !capabilities)
              throw Error("Host execution unavailable");
            if (busy || state)
              throw Error(
                "This launch accepts one job; preserve it and start a fresh launch for another",
              );
            if (req.headers["content-type"] !== "application/zip")
              throw Error("Select a reviewed text package internally");
            let n = 0;
            const parts = [];
            for await (const part of req) {
              n += part.length;
              if (n > MAX_BODY) throw Error("Package exceeds 8 MiB");
              parts.push(part);
            }
            const bytes = Buffer.concat(parts);
            const pkg = await loadPackage(bytes); // Validate before creating job artifacts.
            busy = true;
            try {
              await writeFile(join(root, "selected-package.zip"), bytes, {
                flag: "wx",
                mode: 0o600,
              });
              const prepared = await prepareJob(
                join(root, "selected-package.zip"),
                jobRoot(),
                {
                  mode: "host-assisted",
                  host: capabilities.executor,
                  model: capabilities.model,
                },
              );
              state = {
                kind: "reword-local-text-job",
                schemaVersion: 1,
                id: randomUUID(),
                createdAt: new Date().toISOString(),
                status: "prepared",
                sourceSha256: pkg.sourceSha256,
                packageSha256: pkg.packageSha256,
                documentKey: pkg.documentKey,
                documentName: pkg.documentName,
                runnerJobId: prepared.jobId,
                executor: capabilities,
                modelTurns: 0,
                dispatches: [],
                acceptedByUser: false,
                exported: false,
              };
              await save();
            } finally {
              busy = false;
            }
            execution = execute().catch((error) => {
              state.error = error.message;
              state.status = "failed";
              void save();
            });
            return send(202, { job: await publicStatus() });
          }
          if (req.method === "POST" && path === "/api/cancel") {
            if (!busy || !controller) throw Error("No owned active run");
            state.cancelled = true;
            controller.abort();
            return send(202, { cancelRequested: true });
          }
          if (req.method === "POST" && path === "/api/resume") {
            if (collectionOptions.textEnabled || collectionOptions.imageEnabled) throw Error("New execution uses the reviewed collection flow; earlier records remain readable");
            if (await collections.blocked(false)) throw Error("An active or uncertain collection blocks legacy starts");
            if (!live || !state || busy || state.cancelled || state.exported)
              throw Error("Job cannot be resumed");
            if (state.dispatches.some((x) => !x.rawSha256))
              throw Error(
                "Uncertain dispatched attempt requires review; no model retry",
              );
            execution = execute().catch((error) => {
              state.error = error.message;
              state.status = "failed";
              void save();
            });
            return send(202, { resuming: true });
          }
          const match = path.match(/^\/api\/artifact\/([^/]+)$/);
          if (req.method === "GET" && match && state?.exported) {
            const name = match[1];
            const raw = state.dispatches.find(
              (x) => x.rawSha256 && name === x.stage + "-raw.json",
            );
            const file =
              name === "package.zip"
                ? join(jobRoot(), "package.zip")
                : raw
                  ? join(root, raw.stage + "-" + raw.ticketId + "-raw.json")
                  : artifacts.includes(name)
                    ? join(root, "review", name)
                    : null;
            if (!file) throw Error("Unknown artifact");
            const bytes = await boundedFile(file);
            res.writeHead(200, {
              "content-type": "application/octet-stream",
              "content-disposition": `attachment; filename="${match[1]}"`,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            });
            return res.end(bytes);
          }
          return send(404, { error: "Unknown local endpoint" });
        }
        if (req.method !== "GET") return send(405, { error: "GET only" });
        if (path.includes("%") || path.includes("..") || path.includes("\\"))
          throw Error("Unsafe asset path");
        const asset =
          path === "/" || path === "/image/" || path === "/image"
            ? "index.html"
            : path.slice(1);
        // Only the built public files are exposed; never source, state, or arbitrary filesystem paths.
        const candidate = resolve(dist, asset);
        if (!candidate.startsWith(dist + "/")) throw Error("Unsafe asset path");
        const bytes = await boundedFile(candidate, 20 * 1024 * 1024);
        const mime =
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".mjs": "text/javascript",
            ".wasm": "application/wasm",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".woff2": "font/woff2",
          }[extname(candidate)] ?? "application/octet-stream";
        res.writeHead(200, {
          "content-type": mime,
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        });
        res.end(bytes);
      } catch (error) {
        send(400, { error: error.message });
      }
    });
    await new Promise((ok, bad) => {
      server.once("error", bad);
      server.listen(port, "127.0.0.1", ok);
    });
    authority = `127.0.0.1:${server.address().port}`;
    try {
      if (live) await connect();
    } catch (error) {
      capabilities = null;
      await writeFile(
        join(root, "capability-error.json"),
        JSON.stringify({ error: error.message, modelCalls: 0 }),
      );
    }
    return {
      server,
      root,
      url: `http://${authority}/`,
      get state() {
        return state;
      },
      connect,
      execute,
      close: async () => {
        controller?.abort();
        host?.close();
        await execution;
        await collections.close();
        server.closeAllConnections();
        await new Promise((ok) => server.close(ok));
        await release();
      },
      snapshot: publicStatus,
    };
  } catch (error) {
    await release();
    throw error;
  }
}
