// Recorded discovery, not a live execution capability or a generation authorization.
export const IMAGE_CONNECTION = Object.freeze({
  kind: "reword-local-image-preparation",
  schemaVersion: 1,
  generationAvailable: false,
  smokeAuthorized: false,
  interfaceVersion: "0.153.4",
  providerImageGenerationAdvertised: true,
  referenceInput:
    "Exact PNG data URL and exact canonical prompt observed at the offline request boundary.",
  resultTransport:
    "Not established: the offline custom-provider probe emitted no imageGeneration result item. The built-in provider cannot be redirected to that fixture.",
  boundary:
    "The text-only controls were observed. An image-capable tool/data boundary has not been demonstrated.",
  actualImageModel: null,
  newModelCalls: 0,
  newImageCalls: 0,
  observationDate: "2026-09-09",
  reason:
    "Image execution is unavailable: supported exact original output-byte transport and an image-capable execution boundary remain unverified. No new image smoke is authorized.",
});
export const IMAGE_PREPARATION_CAPABILITY = Object.freeze({
  schemaVersion: 1,
  adapter: "unsupported",
  tool: null,
  referenceFileInput: true,
  exactOutputArtifact: false,
  smokeAuthorized: false,
  observation: IMAGE_CONNECTION.reason,
});
