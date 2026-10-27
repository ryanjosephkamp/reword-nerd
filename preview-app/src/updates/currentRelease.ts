import ledger from "../../content/updates/releases.json";

type LedgerEntry = {
  kind: string;
  status: string;
  slug: string;
  version?: string;
};

const currentRelease = (ledger.entries as LedgerEntry[]).find((entry) => entry.kind === "release" && entry.status === "current");

if (!currentRelease?.version) throw new Error("The Updates ledger must declare one current release.");

export const CURRENT_RELEASE_SLUG = currentRelease.slug;
export const CURRENT_RELEASE_VERSION = currentRelease.version;
export const CURRENT_RELEASE_POST_PATH = `${import.meta.env.BASE_URL}updates/${CURRENT_RELEASE_SLUG}/`;
