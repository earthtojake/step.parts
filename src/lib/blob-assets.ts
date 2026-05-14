import { existsSync } from "node:fs";
import path from "node:path";

export const BLOB_BASE_URL_ENV = "STEP_PARTS_BLOB_BASE_URL";
const DEFAULT_PUBLIC_BLOB_BASE_URL = "https://8ljrorjug0ps5al0.public.blob.vercel-storage.com";

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

function localPreviewPath(kind: BlobAssetKind, id: string) {
  const { extension } = ASSET_CONFIG[kind];
  return path.join(process.cwd(), "public", kind, `${id}.${extension}`);
}

function localPreviewAssetsEnabled() {
  return process.env.NODE_ENV === "development";
}

function fallbackBlobBaseUrl() {
  return localPreviewAssetsEnabled() ? DEFAULT_PUBLIC_BLOB_BASE_URL : undefined;
}

export function blobAssetUrl(kind: BlobAssetKind, id: string, stepSha256: string) {
  const base = normalizeBlobBaseUrl(process.env[BLOB_BASE_URL_ENV] ?? fallbackBlobBaseUrl());

  if (localPreviewAssetsEnabled() && existsSync(localPreviewPath(kind, id))) {
    return localPreviewUrl(kind, id);
  }

  if (base) {
    return new URL(blobAssetPath(kind, id, stepSha256), `${base}/`).toString();
  }

  if (process.env.VERCEL_ENV === "production") {
    throw new Error(`${BLOB_BASE_URL_ENV} is required in production to serve ${kind.toUpperCase()} preview assets`);
  }

  return localPreviewUrl(kind, id);
}
