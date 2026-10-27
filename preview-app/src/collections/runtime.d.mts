export interface RuntimeChoice { model: string; effort: string }
export interface RuntimeCatalog { version: 1; source: string; fetchedAt: string; expiresAt: string; models: { id: string; name: string; efforts: string[]; inputModalities: string[]; hidden: boolean }[]; contextWindowTokens: null; imageGenerator: string }
export interface ResolvedRuntime extends RuntimeChoice { availability: "catalog" | "unverified"; dispatchable: boolean; reason?: string; catalogFetchedAt?: string; imageGenerator: string }
export const CATALOG_TTL_MS: number;
export const RUNTIME_ID: RegExp;
export const EFFORT_ID: RegExp;
export function normalizeCatalog(pages: unknown[], now?: number): RuntimeCatalog;
export function discoverCatalog(request: (method: string, params: unknown) => Promise<unknown>, now?: number): Promise<RuntimeCatalog>;
export function resolveRuntime(catalog: RuntimeCatalog | null, requested: RuntimeChoice | null, operation?: "text" | "image", now?: number): ResolvedRuntime;
