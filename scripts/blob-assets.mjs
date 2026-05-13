export const BLOB_BASE_URL_ENV = "STEP_PARTS_BLOB_BASE_URL";
export const BLOB_ASSET_PREFIX = "preview";
export const BLOB_CACHE_CONTROL_MAX_AGE_SECONDS = 31_536_000;

const ASSET_CONFIG = {
  glb: {
    extension: "glb",
    contentType: "model/gltf-binary",
  },
  png: {
    extension: "png",
    contentType: "image/png",
  },
};

export function assertBlobAssetKind(kind) {
  if (!Object.hasOwn(ASSET_CONFIG, kind)) {
    throw new Error(`Unsupported Blob asset kind: ${kind}`);
  }
}

export function blobAssetPath(kind, id, stepSha256) {
  assertBlobAssetKind(kind);

  if (!/^[a-z0-9_]+$/.test(id)) {
    throw new Error(`Unsupported Blob asset id: ${id}`);
  }

  if (!/^[a-f0-9]{64}$/.test(stepSha256)) {
    throw new Error(`Unsupported Blob asset STEP SHA-256 for ${id}: ${stepSha256}`);
  }

  const { extension } = ASSET_CONFIG[kind];
  return `${BLOB_ASSET_PREFIX}/${kind}/${id}-${stepSha256}.${extension}`;
}

export function blobAssetContentType(kind) {
  assertBlobAssetKind(kind);
  return ASSET_CONFIG[kind].contentType;
}

export function normalizeBlobBaseUrl(value) {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  const url = new URL(candidate);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/g, "");
  return url.toString().replace(/\/+$/g, "");
}

export function blobAssetUrl(baseUrl, kind, id, stepSha256) {
  const base = normalizeBlobBaseUrl(baseUrl);
  if (!base) {
    throw new Error(`${BLOB_BASE_URL_ENV} is required to build Blob asset URLs`);
  }

  return new URL(blobAssetPath(kind, id, stepSha256), `${base}/`).toString();
}
