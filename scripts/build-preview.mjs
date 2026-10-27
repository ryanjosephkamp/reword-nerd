import { spawnSync } from "node:child_process";
import { cp, readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, ".."), dist = join(root, "dist");
const classicBuild = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { cwd: root, stdio: "inherit", env: process.env });
if (classicBuild.error || classicBuild.status !== 0) throw Error("The classic build failed.", { cause: classicBuild.error });
async function inventory(directory, prefix = "") {
  const result = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const path = join(directory, entry.name), key = prefix + entry.name;
    if (entry.isSymbolicLink()) throw Error("Publication output contains a link.");
    if (entry.isDirectory()) Object.assign(result, await inventory(path, key + "/"));
    else result[key] = createHash("sha256").update(await readFile(path)).digest("hex");
  }
  return result;
}
const legacy = await inventory(dist);
if (!legacy["index.html"] || !legacy["image/index.html"] || !legacy["updates/index.html"] || Object.keys(legacy).some(p => p.startsWith("preview/"))) throw Error("Build the classic site into a fresh dist directory before adding the preview.");
const base = process.env.VITE_BASE_PATH || "/";
if (!/^\/[a-zA-Z0-9/_-]*\/$/.test(base) && base !== "/") throw Error("Invalid site base path.");
const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { cwd: join(root, "preview-app"), stdio: "inherit", env: { ...process.env, VITE_BASE_PATH: base + "preview/" } });
if (result.error || result.status !== 0) throw Error("The separate preview build failed.", { cause: result.error });
await cp(join(root, "preview-app/dist"), join(dist, "preview"), { recursive: true, force: false, errorOnExist: true });
const combined = await inventory(dist);
const preserved = Object.fromEntries(Object.entries(combined).filter(([path]) => !path.startsWith("preview/")));
if (JSON.stringify(legacy) !== JSON.stringify(preserved)) throw Error("Adding the preview changed a classic publication artifact.");
for (const path of ["preview/index.html", "preview/image/index.html"]) {
  const source = await readFile(join(dist, path), "utf8");
  if (!source.includes(base + "preview/assets/")) throw Error(`Preview asset base is incorrect in ${path}.`);
}
console.log(`Preserved all ${Object.keys(legacy).length} classic publication files byte-for-byte; added ${Object.keys(combined).length - Object.keys(legacy).length} preview files.`);
