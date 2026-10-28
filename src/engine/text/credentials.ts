// Files that look like they hold passwords, keys, or tokens are left out of projects. They're
// listed as skipped, and their contents are never kept or hashed.
import { baseName, decodeText, extensionOf, hasBinarySignature } from "./formats";

const CREDENTIAL_NAMES = new Set([
  ".env",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  ".pgpass",
  ".htpasswd",
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

const KEY_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".ppk"]);

/** Templates that list the settings a project needs, without the values. */
const ENV_TEMPLATES = new Set([".env.example", ".env.sample", ".env.template", ".env.dist"]);

export function isCredentialName(path: string): boolean {
  const name = baseName(path).toLowerCase();
  if (CREDENTIAL_NAMES.has(name)) return true;
  if (name.startsWith(".env.")) return !ENV_TEMPLATES.has(name);
  // A public key is meant to be shared; its contents are still checked for a private one.
  return KEY_EXTENSIONS.has(extensionOf(name)) && !name.includes("public");
}

const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|PuTTY-User-Key-File-\d/;

/** Formats of real keys from well-known services, matched wherever they appear. */
const KNOWN_TOKENS =
  /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|(?:AKIA|ASIA)[0-9A-Z]{16}|xox[bpas]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,})/g;

const BEARER = /\bAuthorization["']?\s*[:=]\s*["']?Bearer\s+([A-Za-z0-9._~+/=-]{20,})/gi;

/** A password written into a URL, as in .git-credentials or a database connection string. */
const URL_PASSWORD = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]{6,})@[^\s/]+/gi;

const KUBECONFIG_KEY = /\b(?:client-key-data|token):\s*["']?([A-Za-z0-9+/=._-]{40,})/g;

// The setting's name must end in the secret word, so "tokenizer" or "max_tokens" don't count.
const SECRET_NAME = String.raw`[A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?key|private[_-]?key|secret(?:[_-]?access)?(?:[_-]?key)?|token|passw(?:or)?d)`;

/**
 * `NAME = "value"` in code, JSON, or config, with optional `const`, `let`, `var`, `export`,
 * an object in front (`self.`, `openai.`), and a type annotation.
 */
const QUOTED_SECRET = new RegExp(
  String.raw`(?:^|[\n{,;(])[ \t]*(?:export[ \t]+)?(?:(?:const|let|var|val|final)[ \t]+)?@?(?:[A-Za-z_$][\w$]*\.)*["']?${SECRET_NAME}["']?[ \t]*(?::[ \t]*[A-Za-z_][\w.<>[\]]*[ \t]*)?[:=][ \t]*(["'])([^\s"']{8,})\1`,
  "gi",
);

/** `NAME=value` or `name: value` filling a whole line, as in .env, shell, YAML, and INI files. */
const LINE_SECRET = new RegExp(
  String.raw`(?:^|\n)[ \t]*(?:export[ \t]+)?${SECRET_NAME}[ \t]*[:=][ \t]*([^\s"'#,;()[\]{}<>]{8,})[ \t]*(?=\r?\n|#|$)`,
  "gi",
);

const PLACEHOLDER =
  /^[$<%{]|example|sample|placeholder|changeme|change-me|your[_-]|dummy|fake|redacted|password|x{4,}|\*{3,}|\.{3}/i;

/** Names, types, and words, such as userPassword, settings.OPENAI_KEY, SecretStr, or Passwort. */
function looksLikeIdentifier(value: string): boolean {
  return /^[\p{L}_.:-]+$/u.test(value);
}

function isSecretValue(value: string): boolean {
  return !looksLikeIdentifier(value) && !PLACEHOLDER.test(value) && !/^\d+$/.test(value);
}

function anyMatch(text: string, pattern: RegExp, group: number, test: (value: string) => boolean) {
  for (const match of text.matchAll(pattern)) {
    if (test(match[group])) return true;
  }
  return false;
}

function hasSecret(text: string): boolean {
  const notPlaceholder = (value: string) => !PLACEHOLDER.test(value);
  return (
    PRIVATE_KEY.test(text) ||
    anyMatch(text, KNOWN_TOKENS, 0, notPlaceholder) ||
    anyMatch(text, BEARER, 1, isSecretValue) ||
    anyMatch(text, URL_PASSWORD, 1, isSecretValue) ||
    anyMatch(text, KUBECONFIG_KEY, 1, isSecretValue) ||
    anyMatch(text, QUOTED_SECRET, 2, isSecretValue) ||
    anyMatch(text, LINE_SECRET, 1, isSecretValue)
  );
}

// Control characters and broken bytes are stripped so a NUL in front can't hide a secret.
// eslint-disable-next-line no-control-regex
const NOISE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f�]/g;

/** True when the file contains a private key, a known service key, or a password written out. */
export function hasCredentialContent(bytes: Uint8Array): boolean {
  if (hasBinarySignature(bytes)) return false;
  const decoded = decodeText(bytes);
  const text = decoded.ok ? decoded.text : new TextDecoder().decode(bytes).replace(NOISE, "");
  return hasSecret(text);
}
