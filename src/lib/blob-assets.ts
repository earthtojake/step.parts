export const BLOB_BASE_URL_ENV = "STEP_PARTS_BLOB_BASE_URL";

type BlobAssetKind = "glb" | "png";

const ASSET_CONFIG: Record<BlobAssetKind, { extension: string }> = {
  glb: { extension: "glb" },
  png: { extension: "png" },
};

function blobAssetPath(kind: BlobAssetKind, id: string, stepSha256: string) {
  if (!/^[a-z0-9_]+$/.test(id)) {
    throw new Error(`Unsupported Blob asset id: ${id}`);
  }

  if (!/^[a-f0-9]{64}$/.test(stepSha256)) {
    throw new Error(`Unsupported Blob asset STEP SHA-256 for ${id}: ${stepSha256}`);
  }

  const { extension } = ASSET_CONFIG[kind];
  return `preview/${kind}/${id}-${stepSha256}.${extension}`;
}

function normalizeBlobBaseUrl(value: string | undefined) {
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

function localPreviewUrl(kind: BlobAssetKind, id: string) {
  const { extension } = ASSET_CONFIG[kind];
  return `/${kind}/${id}.${extension}`;
}

export function blobAssetUrl(kind: BlobAssetKind, id: string, stepSha256: string) {
  const base = normalizeBlobBaseUrl(process.env[BLOB_BASE_URL_ENV]);

  if (!base) {
    if (process.env.VERCEL_ENV === "production") {
      throw new Error(`${BLOB_BASE_URL_ENV} is required in production to serve ${kind.toUpperCase()} preview assets`);
    }

    return localPreviewUrl(kind, id);
  }

  return new URL(blobAssetPath(kind, id, stepSha256), `${base}/`).toString();
}
