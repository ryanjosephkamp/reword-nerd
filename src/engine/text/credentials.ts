// Files that look like they hold passwords, keys, or tokens are left out of projects. They're
// listed as skipped, and their contents are never kept or hashed.
import { baseName, decodeText, extensionOf, hasBinarySignature } from "./formats";

const CREDENTIAL_NAMES = new Set([
  ".env",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "credentials",
  "credentials.json",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
  "service-account.json",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);

const CREDENTIAL_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"]);

const SAFE_ENV_FILES = new Set([".env.example", ".env.sample"]);

export function isCredentialName(path: string): boolean {
  const name = baseName(path).toLowerCase();
  return (
    CREDENTIAL_NAMES.has(name) ||
    (name.startsWith(".env.") && !SAFE_ENV_FILES.has(name)) ||
    CREDENTIAL_EXTENSIONS.has(extensionOf(name))
  );
}

const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i;

// The setting name must end in the secret word, so "tokenizer" or "max_tokens" don't match.
const SECRET_NAME = String.raw`[A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?key|private[_-]?key|secret(?:[_-]?access)?(?:[_-]?key)?|token|passw(?:or)?d)`;

/** `name: "value"` or `"name": "value"`, at the start of a line or inside an object. */
const QUOTED_SECRET = new RegExp(
  String.raw`(?:^|[\n{,])[ \t]*(?:export[ \t]+)?["']?${SECRET_NAME}["']?[ \t]*[:=][ \t]*["']([^\s"']{8,})["']`,
  "gi",
);

/** `NAME=value` as in .env files and shell scripts, with nothing but a comment after it. */
const BARE_SECRET = new RegExp(
  String.raw`(?:^|\n)[ \t]*(?:export[ \t]+)?${SECRET_NAME}[ \t]*[:=][ \t]*([^\s"'#()[\]{}$,;<>]{8,})[ \t]*(?=\r?\n|#|$)`,
  "gi",
);

const PLACEHOLDER =
  /^(?:example|sample|placeholder|change[_-]?me|your|my[_-]|xxx|dummy|fake|process\.env|os\.environ|env\.|import\.meta)|x{4,}|\*{3,}|\.{3}/i;

function hasClearSecret(text: string): boolean {
  for (const pattern of [QUOTED_SECRET, BARE_SECRET]) {
    for (const match of text.matchAll(pattern)) {
      if (!PLACEHOLDER.test(match[1])) return true;
    }
  }
  return false;
}

// Control characters and broken bytes are stripped so a NUL in front can't hide a secret.
// eslint-disable-next-line no-control-regex
const NOISE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f�]/g;

/** True when the file contains a private key or a password, token, or API key written out. */
export function hasCredentialContent(bytes: Uint8Array): boolean {
  if (hasBinarySignature(bytes)) return false;
  const decoded = decodeText(bytes);
  const text = decoded.ok ? decoded.text : new TextDecoder().decode(bytes).replace(NOISE, "");
  return PRIVATE_KEY.test(text) || hasClearSecret(text);
}
