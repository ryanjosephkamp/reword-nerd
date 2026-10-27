export type Portal = "text" | "image";

const PRODUCTION_ORIGIN = "https://ryanjosephkamp.github.io";

function normalizedBasePath(basePath: string): string {
  const prefixed = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return prefixed.endsWith("/") ? prefixed : `${prefixed}/`;
}

export function portalHref(portal: Portal, basePath = import.meta.env.BASE_URL): string {
  const base = normalizedBasePath(basePath);
  return portal === "text" ? base : `${base}image/`;
}

export function canonicalPortalUrl(portal: Portal): string {
  return new URL(portalHref(portal, "/reword-nerd/"), PRODUCTION_ORIGIN).toString();
}
