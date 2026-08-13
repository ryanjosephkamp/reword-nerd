import packageMetadata from "../package.json";

function assertCurrentVersion(version: string): asserts version is "0.7.0" {
  if (version !== "0.7.0") throw new Error(`Unexpected package version: ${version}`);
}

/** The release version shared by the UI and exported package metadata. */
const packageVersion = packageMetadata.version;
assertCurrentVersion(packageVersion);
export const APP_VERSION = packageVersion;
