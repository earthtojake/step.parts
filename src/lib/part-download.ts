import path from "node:path";

const DEFAULT_GITHUB_REPOSITORY = "earthtojake/step.parts";
const LOCAL_STEP_DIRECTORY = `${process.cwd()}/catalog/step`;
const LOCAL_STEP_URL_PREFIX = "/step/";
const STEP_ASSET_MODE_ENV = "STEP_PARTS_STEP_ASSET_MODE";

function cleanSegment(value: string | undefined) {
  return value?.trim().replace(/^\/+|\/+$/g, "") ?? "";
}

function githubRepository() {
  const repository = cleanSegment(process.env.STEP_PARTS_GITHUB_REPOSITORY);
  if (repository) {
    return repository;
  }

  const owner = cleanSegment(process.env.STEP_PARTS_GITHUB_OWNER ?? process.env.VERCEL_GIT_REPO_OWNER);
  const repo = cleanSegment(process.env.STEP_PARTS_GITHUB_REPO ?? process.env.VERCEL_GIT_REPO_SLUG);
  if (owner && repo) {
    return `${owner}/${repo}`;
  }

  return DEFAULT_GITHUB_REPOSITORY;
}

function githubRef() {
  return cleanSegment(process.env.STEP_PARTS_GITHUB_REF ?? process.env.VERCEL_GIT_COMMIT_SHA) || "main";
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value);
}

export function localStepUrlForId(id: string) {
  return `${LOCAL_STEP_URL_PREFIX}${id}.step`;
}

export function githubStepUrlForId(id: string) {
  const [owner = "earthtojake", repo = "step.parts"] = githubRepository().split("/", 2);
  const ref = githubRef();

  return `https://media.githubusercontent.com/media/${encodePathSegment(owner)}/${encodePathSegment(repo)}/${encodePathSegment(ref)}/catalog/step/${encodePathSegment(id)}.step`;
}

export function githubStepAssetsEnabled() {
  const mode = cleanSegment(process.env[STEP_ASSET_MODE_ENV]).toLowerCase();

  if (mode) {
    return mode === "github" || mode === "remote" || mode === "production";
  }

  return process.env.NODE_ENV === "production";
}

export function stepUrlForId(id: string) {
  return githubStepAssetsEnabled() ? githubStepUrlForId(id) : localStepUrlForId(id);
}

export function localStepPathForId(id: string) {
  if (!/^[a-z0-9_]+$/.test(id)) {
    throw new Error(`Unsupported STEP asset id: ${id}`);
  }

  return `${LOCAL_STEP_DIRECTORY}/${id}.step`;
}

export function localStepPath(stepUrlOrId: string) {
  const [pathname] = stepUrlOrId.split(/[?#]/);
  const normalizedPath = path.posix.normalize(pathname ?? "");

  if (/^[a-z0-9_]+$/.test(normalizedPath)) {
    return localStepPathForId(normalizedPath);
  }

  if (!normalizedPath.startsWith(LOCAL_STEP_URL_PREFIX) || normalizedPath.endsWith("/")) {
    throw new Error(`Unsupported STEP asset path: ${stepUrlOrId}`);
  }

  const filename = path.posix.basename(normalizedPath);
  const id = filename.endsWith(".step") ? filename.slice(0, -".step".length) : "";

  if (!/^[a-z0-9_]+$/.test(id)) {
    throw new Error(`Unsupported STEP asset path: ${stepUrlOrId}`);
  }

  return localStepPathForId(id);
}

export function looksLikeStep(bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, 512)));
  return text.includes("ISO-10303") || text.includes("HEADER;");
}
