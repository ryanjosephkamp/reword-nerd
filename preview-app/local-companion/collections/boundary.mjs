/** Versioned adapter evidence; a binary change still fails the runtime SHA pin. */
export const COLLECTION_IMAGE_BOUNDARY = Object.freeze({
  version: 1,
  binaryVersion: "0.153.4",
  status: "offline-verified",
  source: "https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/ext/image-generation/src/tool.rs",
  referenceContract: "ImagegenArgs.referenced_image_paths; explicit absolute paths, max five; one selected path per rendition operation",
  nativeInput: "Repeated plural --image values followed by -- -; original bytes, order and caBX verified at receiver",
  nativePermissions: "Exact selected PNG read whitelist; native sandbox helper denies outside, unselected and symlink paths",
  limitation: "Offline native filesystem helper and official matching-version source establish the boundary; the authenticated imagegen handler itself is not executed offline. Generation and attention remain unproven until a live task is inspected.",
});
