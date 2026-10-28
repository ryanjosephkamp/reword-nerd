import { describe, expect, it } from "vitest";

import { readTextFiles, readTextFolder } from "../../../src/engine/text";
import { readFiles } from "../../../src/engine/text/read";
import {
  MAX_INCLUDED_TEXT_BYTES,
  MAX_INCLUDED_TEXT_FILES,
  MAX_PROJECT_FILE_BYTES,
  MAX_PROJECT_FILES,
} from "../../../src/engine/text/project";
import type { TextSource } from "../../../src/engine/types";
import { encoder, folder, makeZip, OFF, textFile, zipFile } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function readOneFolder(files: Record<string, string | Uint8Array<ArrayBuffer>>) {
  return readTextFolder(folder("project", files), OFF);
}

async function everything(result: { sources: TextSource[] }): Promise<string> {
  const texts = await Promise.all(result.sources.map((source) => source.original.text()));
  return JSON.stringify(result) + texts.join("\n");
}

describe("folder projects", () => {
  it("reads one folder as one project and sorts out text, assets, and skipped files", async () => {
    // Catches dependency folders, ignored files, or secrets reaching the job.
    const result = await readOneFolder({
      "src/main.ts": "export const answer = 42;\r\n",
      "ignored.txt": "ignored\n",
      ".gitignore": "ignored.txt\nlogs/\n",
      "logs/one.txt": "one\n",
      "logs/two.txt": "two\n",
      "node_modules/pkg/index.js": "vendored\n",
      "node_modules/pkg/lib/more.js": "vendored\n",
      "package-lock.json": "{}\n",
      "public/logo.png": PNG,
      "pkg/__init__.py": "",
      "vendor.zip": "PK",
      ".env": "API_TOKEN=clear-secret-value\n",
    });
    const [project] = result.projects;

    expect(result.rejected).toEqual([]);
    expect(project).toMatchObject({
      name: "project",
      from: "folder",
      classification: "general",
      mainFile: null,
      excluded: [
        { path: ".env", reason: "credentials" },
        { path: "ignored.txt", reason: "ignored-by-gitignore" },
        { path: "logs/", reason: "ignored-by-gitignore" },
        { path: "node_modules/", reason: "dependency-or-build-output" },
        { path: "package-lock.json", reason: "lock-file" },
        { path: "vendor.zip", reason: "nested-archive" },
      ],
    });
    expect(project.assets.map((asset) => asset.path)).toEqual([
      "pkg/__init__.py",
      "public/logo.png",
    ]);
    expect(result.sources.map((source) => [source.path, source.languageId])).toEqual([
      [".gitignore", "plaintext"],
      ["src/main.ts", "typescript"],
    ]);
    expect(result.sources.every((source) => source.projectId === project.id)).toBe(true);
    expect(result.sources[1]).toMatchObject({
      extractedText: "export const answer = 42;\r\n",
      included: true,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(await everything(result)).not.toContain("clear-secret-value");
  });

  it("gives identical files the same hashes whatever order the browser lists them in", async () => {
    const first = await readTextFolder(folder("p", { "b.txt": "beta\n", "a.txt": "alpha\n" }), OFF);
    const second = await readTextFolder(
      folder("p", { "a.txt": "alpha\n", "b.txt": "beta\n" }),
      OFF,
    );
    const summary = (sources: TextSource[]) => sources.map(({ path, sha256 }) => [path, sha256]);
    expect(summary(first.sources)).toEqual(summary(second.sources));
  });

  it("makes one project per top-level folder and reads loose files on their own", async () => {
    const result = await readTextFolder(
      [
        ...folder("first", { "a.md": "# A\n" }),
        { file: textFile("b.md", "# B\n"), path: "/second/b.md" },
        { file: textFile("loose.txt", "loose\n"), path: "loose.txt" },
      ],
      OFF,
    );

    expect(result.projects.map((project) => project.name)).toEqual(["first", "second"]);
    expect(result.sources.map((source) => [source.path, source.projectId === null])).toEqual([
      ["a.md", false],
      ["b.md", false],
      ["loose.txt", true],
    ]);
  });

  it("refuses names that can't be unpacked everywhere", async () => {
    // Catches a reserved or colliding name surviving until the hand-off ZIP is unpacked.
    const cases: [Record<string, string>, RegExp][] = [
      [{ "CON.txt": "x" }, /Windows reserves \(CON\)/],
      [{ "dir/aux.md": "x" }, /Windows reserves \(AUX\)/],
      [{ "dir/name:stream.txt": "x" }, /colon/],
      [{ "dir/trailing. ": "x" }, /ends with a dot or space/],
      [{ [`${"a".repeat(256)}.txt`]: "x" }, /too long/],
      [{ [`${"a/".repeat(512)}z.txt`]: "x" }, /too long/],
      [{ "Readme.md": "one", "README.md": "two" }, /differ only in capital letters/],
      [{ "Straße.txt": "one", "STRASSE.txt": "two" }, /differ only in capital letters/],
      [{ "caf\u00e9.txt": "one", "cafe\u0301.txt": "two" }, /two files with the same name/],
    ];
    for (const [files, reason] of cases) {
      const result = await readOneFolder(files);
      expect(result.projects).toEqual([]);
      expect(result.rejected).toEqual([{ name: "project", reason: expect.stringMatching(reason) }]);
    }
  });

  it("skips reserved names inside dependency folders instead of refusing the project", async () => {
    const result = await readOneFolder({ "node_modules/x/aux.js": "x", "a.txt": "a" });
    expect(result.rejected).toEqual([]);
    expect(result.projects[0].excluded).toEqual([
      { path: "node_modules/", reason: "dependency-or-build-output" },
    ]);
  });

  it("skips oversized files and refuses projects with too many files to read", async () => {
    const big = {
      file: { name: "big.txt", size: MAX_PROJECT_FILE_BYTES + 1 } as File,
      path: "project/big.txt",
    };
    const sized = await readTextFolder([big, ...folder("project", { "a.txt": "a" })], OFF);
    expect(sized.projects[0].excluded).toEqual([{ path: "big.txt", reason: "too-large" }]);

    const files = Object.fromEntries(
      Array.from({ length: MAX_PROJECT_FILES + 1 }, (_, i) => [`f${i}.txt`, "x"]),
    );
    const crowded = await readOneFolder(files);
    expect(crowded.rejected[0].reason).toMatch(/more than 500 files/);
  });

  it("starts files beyond the job limits as not included, without cutting their text", async () => {
    // Catches limits truncating text or silently building an oversized job.
    const files: Record<string, string> = {};
    for (let i = 0; i <= MAX_INCLUDED_TEXT_FILES; i += 1) {
      files[`src/${String(i).padStart(3, "0")}.txt`] = `file ${i}\n`;
    }
    files["src/huge.txt"] = "x".repeat(MAX_INCLUDED_TEXT_BYTES + 1);
    const result = await readOneFolder(files);
    const included = result.sources.filter((source) => source.included);
    const overCount = result.sources.find((source) => source.path === "src/250.txt");
    const huge = result.sources.find((source) => source.path === "src/huge.txt");

    expect(included).toHaveLength(MAX_INCLUDED_TEXT_FILES);
    expect(overCount).toMatchObject({ included: false });
    expect(overCount?.notes[0]).toMatch(/more than 250 text files/);
    expect(huge).toMatchObject({ included: false, text: "x".repeat(MAX_INCLUDED_TEXT_BYTES + 1) });
  });

  it("skips binary files and text it can't decode, keeping empty files as assets", async () => {
    const result = await readOneFolder({
      "data.bin": new Uint8Array([1, 0, 2, 0]),
      "legacy.txt": new Uint8Array([0x63, 0x61, 0x66, 0xe9]),
      "empty.md": "",
      "notes.txt": "notes\n",
    });
    expect(result.projects[0].excluded).toEqual([
      { path: "data.bin", reason: "binary" },
      { path: "legacy.txt", reason: "unreadable-text" },
    ]);
    expect(result.projects[0].assets.map((asset) => asset.path)).toEqual(["empty.md"]);
  });

  it("refuses a folder with nothing to read", async () => {
    const result = await readOneFolder({ "logo.png": PNG, "node_modules/a.js": "a" });
    expect(result.rejected).toEqual([
      {
        name: "project",
        reason:
          "This folder has no text files that can be read. Everything in it was skipped or isn't text.",
      },
    ]);
  });
});

describe("credentials", () => {
  it("skips files with secrets in them, by name or by content, and never keeps their text", async () => {
    // Catches common credential syntax, service keys, or private-key headers reaching the job.
    const secrets = {
      "config.json": '{ "api_key": "a1b2c3d4e5f6g7h8" }\n',
      "launch.sh": "export TOKEN=s3cr3t-Value-91\n",
      "aws.txt": "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYz9\n",
      "settings.yaml": "database:\n  password: hunter2-Prod-7\n",
      "innocent-notes.txt": "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIFHDBOBgkq\n",
      "ordinary-readme.md": "-----BEGIN DSA PRIVATE KEY-----\nMIIBuwIBAAKB\n",
      "keys/server.pem": "anything",
      ".env.production": "X=1\n",
      "control.txt": new Uint8Array([0, ...encoder.encode("API_TOKEN=s3cr3t-Value-91\n")]),
      "broken.txt": new Uint8Array([0xff, ...encoder.encode("PASSWORD=s3cr3t-Value-91\n")]),
    };
    const result = await readOneFolder({
      "safe.txt": "safe text\n",
      "figure.png": PNG,
      ...secrets,
    });

    expect(result.sources.map((source) => source.path)).toEqual(["safe.txt"]);
    expect(result.projects[0].assets.map((asset) => asset.path)).toEqual(["figure.png"]);
    expect(result.projects[0].excluded.map((item) => item.path).sort()).toEqual(
      Object.keys(secrets).sort(),
    );
    expect(result.projects[0].excluded.every((item) => item.reason === "credentials")).toBe(true);
    expect(await everything(result)).not.toMatch(/s3cr3t|hunter2|a1b2c3d4/);
  });

  it("finds secrets assigned in code, service keys, bearer tokens, and credential files", async () => {
    // Catches the misses from review: declarations, object fields, bare key ids, and key files.
    const secrets = {
      "keys.ts": 'const API_KEY = "sk-proj-4fJ9xQ2LmN8pR7sT1vW3yZ5a";\n',
      "config.mjs": 'export const stripeSecret = "rk_live_51Hx9Lm2Q8pZ";\n',
      "client.py": 'openai.api_key = "a8f3k2m9q7w1e5r4"\n',
      "user.py": 'self.password = "Tr0ub4dor&3"\n',
      "auth.js": "let token = 'eyJhbGciOiJIUzI1NiJ9.e30.abc123';\n",
      "aws-notes.txt": "The key id AKIAQ3EGUZ7YXJ4KD2PL is for staging.\n",
      "github.txt": "Use ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8 to push.\n",
      "slack.md": "Bot token: xoxb-2468013579-abcdefghij\n",
      "request.http": "GET /me\nAuthorization: Bearer 9f8e7d6c5b4a39281706f5e4d3c2b1a0\n",
      "deploy-notes.txt": "Clone https://deploy:S3cr3tPass9@git.internal.org/repo.git\n",
      "kubeconfig.yaml":
        "users:\n- name: ci\n  user:\n    client-key-data: LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQo3aGJ\n",
      ".git-credentials": "https://ada:token@github.com\n",
      ".pgpass": "localhost:5432:*:ada:pw\n",
      ".htpasswd": "ada:$apr1$abc$def\n",
      "server.ppk": "PuTTY-User-Key-File-3: ssh-ed25519\n",
    };
    const result = await readOneFolder({ "safe.txt": "safe\n", ...secrets });

    expect(result.sources.map((source) => source.path)).toEqual(["safe.txt"]);
    expect(result.projects[0].excluded.map((item) => item.path).sort()).toEqual(
      Object.keys(secrets).sort(),
    );
  });

  it("doesn't mistake names, types, translations, or templates for secrets", async () => {
    // Catches the false positives from review, which left ordinary code out of the job.
    const files = {
      "config.ts": "export default {\n  apiKey: process.env.API_KEY,\n  token: getToken(),\n};\n",
      "login.ts": "const body = {\n  accessToken: AccessToken,\n  password: userPassword\n};\n",
      "settings.py": 'api_key=settings.OPENAI_KEY\nAPI_KEY = os.getenv("API_KEY")\n',
      "models.py": "class Settings(BaseSettings):\n    api_key: SecretStr\n    token: AuthToken\n",
      "session.py": "token = defaultToken\n",
      "de.json": '{ "password": "Passwort", "token": "Zugangsschlüssel" }\n',
      "model.yaml": "tokenizer: bert-base-uncased\nmax_tokens: 4096\n",
      "docker-compose.yml": "  DATABASE_URL: postgres://postgres:postgres@db:5432/app\n",
      "README.md": "Set `API_KEY=sk-live-123456789` and use AKIAIOSFODNN7EXAMPLE as in the docs.\n",
      ".env.example": "API_KEY=your-api-key-here\nSECRET=changeme-please\n",
      ".env.template": "TOKEN=\n",
      ".env.dist": "PASSWORD=\n",
      ".env.sample": "API_KEY=<your key>\n",
      "public.pem": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq\n-----END PUBLIC KEY-----\n",
    };
    const result = await readOneFolder(files);
    expect(result.projects[0].excluded).toEqual([]);
    expect(result.sources).toHaveLength(Object.keys(files).length);
  });
});

describe("skipped folders", () => {
  it("skips dependency and tool folders at any depth", async () => {
    const result = await readOneFolder({
      "a.txt": "a",
      "server/.venv/lib/site.py": "x",
      "venv/bin/activate": "x",
      "ios/Pods/Lib/a.h": "x",
      "infra/.terraform/state": "x",
      "android/.gradle/cache.txt": "x",
      "py/.tox/log.txt": "x",
      "deep/node_modules/x/index.js": "x",
    });
    expect(result.projects[0].excluded.map((item) => item.path)).toEqual([
      "android/.gradle/",
      "deep/node_modules/",
      "infra/.terraform/",
      "ios/Pods/",
      "py/.tox/",
      "server/.venv/",
      "venv/",
    ]);
  });

  it("skips build folders only at the root or beside a project manifest", async () => {
    // Catches src/cache/, src/build/, and app/gen/ (ordinary source) being dropped.
    const result = await readOneFolder({
      "dist/app.js": "x",
      "src/cache/store.ts": "export {};\n",
      "src/build/steps.ts": "export {};\n",
      "app/gen/names.ts": "export {};\n",
      "packages/web/package.json": "{}\n",
      "packages/web/dist/app.js": "x",
      "packages/web/src/gen/a.ts": "export {};\n",
      "crates/core/Cargo.toml": "[package]\n",
      "crates/core/target/debug.txt": "x",
    });
    expect(result.projects[0].excluded.map((item) => item.path)).toEqual([
      "crates/core/target/",
      "dist/",
      "packages/web/dist/",
    ]);
    expect(result.sources.map((source) => source.path)).toEqual([
      "app/gen/names.ts",
      "crates/core/Cargo.toml",
      "packages/web/package.json",
      "packages/web/src/gen/a.ts",
      "src/build/steps.ts",
      "src/cache/store.ts",
    ]);
  });

  it("ignores macOS folder icons instead of refusing the folder", async () => {
    // Catches "Icon\r" failing the control-character check and sinking the whole folder.
    const result = await readOneFolder({ "a.txt": "a", "Icon\r": "", "docs/Icon\r": "" });
    expect(result.rejected).toEqual([]);
    expect(result.projects[0]).toMatchObject({ excluded: [], assets: [] });
  });

  it("refuses a file and a folder with the same name", async () => {
    const result = await readOneFolder({ notes: "a", "Notes/today.md": "b" });
    expect(result.rejected[0].reason).toMatch(/a file and a folder with the same name/);
  });
});

describe("ZIP projects", () => {
  it("drops the wrapper folder and macOS metadata", async () => {
    const zip = await zipFile("paper.zip", {
      "paper/notes.md": "# Notes\n",
      "paper/src/a.ts": "export {};\n",
      "__MACOSX/paper/._notes.md": new Uint8Array([0, 5, 22, 7]),
      "paper/.DS_Store": new Uint8Array([0, 0, 0, 1]),
      "paper/Icon\r": "",
    });
    const result = await readTextFiles([zip], OFF);

    expect(result.projects[0]).toMatchObject({ name: "paper", from: "zip", excluded: [] });
    expect(result.sources.map((source) => source.path)).toEqual(["notes.md", "src/a.ts"]);
  });

  it("refuses paths that point outside the ZIP", async () => {
    // Catches a zip-slip entry escaping the project when the hand-off is unpacked.
    for (const path of [
      "../outside.txt",
      "/etc/passwd",
      "dir/../../x.txt",
      "C:/x.txt",
      "a\\..\\..\\b",
    ]) {
      const zip = await zipFile("unsafe.zip", { [path]: "outside\n", "ok.txt": "ok\n" });
      const result = await readTextFiles([zip], OFF);
      expect(result.projects).toEqual([]);
      expect(result.rejected[0].reason).toMatch(/unsafe name/);
    }
  });

  it("leaves out one file that expands far beyond its stored size, keeping the rest", async () => {
    // Catches one suspicious file refusing the whole project.
    const zip = await zipFile("compressed.zip", {
      "repeat.txt": "x".repeat(2 * 1024 * 1024),
      "notes.md": "# Notes\n",
    });
    const result = await readTextFiles([zip], OFF);
    expect(result.rejected).toEqual([]);
    expect(result.projects[0].excluded).toEqual([{ path: "repeat.txt", reason: "too-large" }]);
    expect(result.sources.map((source) => source.path)).toEqual(["notes.md"]);
  });

  it("allows small files that happen to compress well", async () => {
    const zip = await zipFile("small.zip", { "spaces.txt": `a${" ".repeat(64 * 1024)}b` });
    const result = await readTextFiles([zip], OFF);
    expect(result.rejected).toEqual([]);
  });

  it("leaves out locked files and links, even inside skipped folders, instead of the project", async () => {
    // Catches node_modules/.bin links or one locked file refusing everything else.
    const linked = await zipFile(
      "linked.zip",
      { "a.txt": "a", "node_modules/.bin/eslint": "../eslint/bin.js", "docs/link.md": "/etc" },
      { modes: { "node_modules/.bin/eslint": 0o120777, "docs/link.md": 0o120777 } },
    );
    const result = await readTextFiles([linked], OFF);
    expect(result.rejected).toEqual([]);
    expect(result.projects[0].excluded).toEqual([
      { path: "docs/link.md", reason: "link-or-locked" },
      { path: "node_modules/", reason: "dependency-or-build-output" },
    ]);

    const locked = await zipFile("locked.zip", { "a.txt": "a" }, { password: "pass-1234" });
    const nothing = await readTextFiles([locked], OFF);
    expect(nothing.rejected[0].reason).toMatch(/no text files that can be read/);
  });

  it("refuses files that aren't ZIPs", async () => {
    const result = await readTextFiles([textFile("fake.zip", "not a zip at all")], OFF);
    expect(result.rejected[0].reason).toMatch(/damaged/);
  });

  it("stops listing a ZIP with too many entries instead of reading them all", async () => {
    // Catches getEntries() reading 65,535 entries (and hundreds of MB) before the count check.
    let listed = 0;
    const openZip = async () => ({
      async *entries() {
        for (let index = 0; index < 65_535; index += 1) {
          listed += 1;
          yield {
            path: `f${index}.txt`,
            directory: false,
            encrypted: false,
            compressedSize: 1,
            uncompressedSize: 1,
            unixMode: null,
            read: async () => undefined,
          };
        }
      },
      close: async () => undefined,
    });
    const result = await readFiles([await zipFile("many.zip", { "a.txt": "a" })], OFF, {
      openZip,
    });
    expect(result.rejected[0].reason).toMatch(/more than 20,000 files/);
    expect(listed).toBe(20_001);
  });

  it("counts what ZIPs unpack to against one budget for the whole call", async () => {
    // Catches 20 small ZIPs each expanding toward 100 MB in one call.
    const zips = await Promise.all(
      ["a", "b", "c"].map((name) => zipFile(`${name}.zip`, { "notes.txt": "x".repeat(400) })),
    );
    const result = await readFiles(zips, OFF, { budgetBytes: 1_000 });
    expect(result.projects.map((project) => project.name)).toEqual(["a", "b"]);
    expect(result.rejected).toEqual([
      { name: "c.zip", reason: expect.stringMatching(/can be read at once/) },
    ]);
  });

  it("honors a root .gitignore inside the wrapper folder", async () => {
    const bytes = await makeZip({
      "repo-main/.gitignore": "*.log\ndrafts/\n",
      "repo-main/README.md": "# Repo\n",
      "repo-main/debug.log": "noise\n",
      "repo-main/drafts/a.md": "draft\n",
    });
    const result = await readTextFiles([new File([bytes], "repo-main.zip")], OFF);
    expect(result.projects[0].excluded).toEqual([
      { path: "debug.log", reason: "dependency-or-build-output" },
      { path: "drafts/", reason: "ignored-by-gitignore" },
    ]);
  });
});
