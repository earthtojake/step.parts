import dns from "node:dns";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs, promisify } from "node:util";
import "./load-env.mjs";
import { BLOB_ASSET_PREFIX, blobAssetPath } from "./blob-assets.mjs";
import { checkStepMetadataForCatalogParts } from "./step-metadata.mjs";
import {
  CATALOG_DB_USER_VERSION,
  catalogRowFromPart,
  exists,
  looksLikeStep,
  materializePart,
  normalizePart,
  normalizeSourcePart,
  obsoleteAssetManifestPath,
  obsoleteCatalogNdjsonPath,
  obsoletePublicCatalogJsonPath,
  obsoletePublicCatalogSqlitePath,
  obsoleteSourceCatalogPath,
  readCatalogRows,
  sqliteCatalogPath,
  sourceCatalogPath,
  stepPathFor,
  stepDir,
  taxonomyPath,
} from "./catalog-utils.mjs";

dns.setDefaultResultOrder("ipv4first");

const execFileAsync = promisify(execFile);
const DEFAULT_CI_MAX_STEP_BYTES = 128 * 1024 * 1024;
const DEFAULT_CI_MAX_TOTAL_STEP_BYTES = 512 * 1024 * 1024;

const { values } = parseArgs({
  allowPositionals: false,
  options: {
    ci: { type: "boolean" },
    "ci-step-content": { type: "boolean" },
    "changed-step": { type: "string", multiple: true },
    "require-blob": { type: "boolean" },
  },
});

const SOURCE_PART_KEYS = new Set([
  "id",
  "name",
  "description",
  "category",
  "family",
  "tags",
  "aliases",
  "standard",
  "stepSource",
  "productPage",
  "attributes",
]);

const PROVENANCE_ATTRIBUTE_KEYS = new Set([
  "cadAsset",
  "cadSourceType",
  "downloadArchive",
  "downloadFile",
  "cadNote",
  "cadRepositoryPath",
  "cadModelVersion",
  "cadModelReleaseDate",
  "verificationLevel",
  "dateChecked",
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertKebabLabel(value, message) {
  assert(typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value), message);
}

function normalizeTagValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function compactTagValue(value) {
  return normalizeTagValue(value).replace(/-/g, "");
}

function standardTagValues(part) {
  if (!part.standard) {
    return [];
  }

  return [
    part.standard.designation,
    `${part.standard.body}${part.standard.number}`,
    `${part.standard.body}-${part.standard.number}`,
    `${part.standard.body} ${part.standard.number}`,
  ];
}

function reservedTagValues(part) {
  const values = [
    part.category,
    part.family,
    part.id,
    part.name,
    ...(part.aliases ?? []),
    ...standardTagValues(part),
    part.attributes.model,
    part.attributes.manufacturer,
    part.attributes.sku,
  ];

  return new Set(values.filter(Boolean).flatMap((value) => [normalizeTagValue(value), compactTagValue(value)]));
}

function assertTags(part) {
  assert(Array.isArray(part.tags) && part.tags.length > 0, `${part.id}: missing tags`);

  const seen = new Set();
  const reserved = reservedTagValues(part);
  const reservedMetadataTags = new Set(["official-step", "community-step"]);

  for (const tag of part.tags) {
    assertKebabLabel(tag, `${part.id}: bad tag ${tag}`);
    assert(!seen.has(tag), `${part.id}: duplicate tag ${tag}`);
    assert(!reservedMetadataTags.has(tag), `${part.id}: ${tag} belongs in dedicated metadata fields, not tags`);
    assert(!reserved.has(tag), `${part.id}: ${tag} duplicates another catalog field`);
    seen.add(tag);
  }
}

function assertStringArray(value, message) {
  assert(Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim()), message);
}

function assertAttributes(value, message) {
  assert(value && typeof value === "object" && !Array.isArray(value), message);
  for (const [key, entry] of Object.entries(value)) {
    assert(/^[a-z][a-zA-Z0-9]*$/.test(key), `${message}: bad key ${key}`);
    assert(!isSourceAttributeKey(key), `${message}: ${key} must be a first-class field or removed`);
    assert(
      entry === null || ["string", "number", "boolean"].includes(typeof entry),
      `${message}: ${key} must be string, number, boolean, or null`,
    );
  }
}

function assertOptionalStringArray(value, message) {
  assert(value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim())), message);
}

function isSourceAttributeKey(key) {
  return key === "stepSource" || key === "productPage" || key.startsWith("source") || PROVENANCE_ATTRIBUTE_KEYS.has(key);
}

function isAbsoluteHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function assertOptionalUrl(value, message) {
  if (value === undefined) {
    return;
  }

  assert(typeof value === "string" && value.trim() === value && isAbsoluteHttpUrl(value), message);
}

function assertOptionalStepSource(value, message) {
  assertOptionalUrl(value, message);
  if (value === undefined) {
    return;
  }

  const pathname = new URL(value).pathname.toLowerCase();
  assert(pathname.endsWith(".step") || pathname.endsWith(".stp"), `${message}: must link directly to a STEP/STP file`);
}

async function readJsonArray(filePath) {
  const value = JSON.parse(await readFile(filePath, "utf8"));
  assert(Array.isArray(value), `${filePath} must contain a JSON array`);
  return value;
}

async function readJsonObject(filePath) {
  const value = JSON.parse(await readFile(filePath, "utf8"));
  assert(value && typeof value === "object" && !Array.isArray(value), `${filePath} must contain a JSON object`);
  return value;
}

async function readSourceParts() {
  const rawParts = await readJsonArray(sourceCatalogPath);
  for (const part of rawParts) {
    const unexpectedKeys = Object.keys(part).filter((key) => !SOURCE_PART_KEYS.has(key));
    assert(
      unexpectedKeys.length === 0,
      `${part.id ?? "<unknown>"}: source catalog has unsupported fields: ${unexpectedKeys.join(", ")}`,
    );
  }

  return rawParts.map(normalizeSourcePart);
}

async function readTaxonomy() {
  return readJsonObject(taxonomyPath);
}

function validatePart(part, ids) {
  assert(/^[a-z0-9_]+$/.test(part.id), `${part.id}: ID must be snake_case ASCII`);
  assert(!ids.has(part.id), `${part.id}: duplicate ID`);
  ids.add(part.id);
  assert(part.name, `${part.id}: missing name`);
  assert(typeof part.description === "string" && part.description.trim(), `${part.id}: missing description`);
  assertKebabLabel(part.category, `${part.id}: bad category`);
  if (part.family !== undefined) {
    assertKebabLabel(part.family, `${part.id}: bad family`);
  }
  assertTags(part);
  assertStringArray(part.aliases, `${part.id}: bad aliases`);
  assertAttributes(part.attributes, `${part.id}: bad attributes`);
  assertOptionalStepSource(part.stepSource, `${part.id}: bad stepSource`);
  assertOptionalUrl(part.productPage, `${part.id}: bad productPage`);

  if (part.standard) {
    assert(part.standard && typeof part.standard === "object" && !Array.isArray(part.standard), `${part.id}: bad standard`);
    assert(typeof part.standard.body === "string" && part.standard.body.trim(), `${part.id}: bad standard body`);
    assert(typeof part.standard.number === "string" && part.standard.number.trim(), `${part.id}: bad standard number`);
    assert(
      typeof part.standard.designation === "string" && part.standard.designation.trim(),
      `${part.id}: bad standard designation`,
    );
  }

  assert(part.stepUrl === `/step/${part.id}.step`, `${part.id}: bad stepUrl`);
  assert(typeof part.byteSize === "number", `${part.id}: byteSize must be generated`);
  assert(/^[a-f0-9]{64}$/.test(part.sha256), `${part.id}: sha256 must be generated`);
}

function assertFieldPath(value, message) {
  assert(
    typeof value === "string" &&
      (/^(id|name|category|family)$/.test(value) ||
        /^standard\.(body|number|designation)$/.test(value) ||
        /^attributes\.[a-z][a-zA-Z0-9]*$/.test(value)),
    message,
  );
}

function validateTaxonomy(taxonomy) {
  const topLevelKeys = new Set(["version", "scope", "rigidFamilies"]);
  const unexpectedTopLevelKeys = Object.keys(taxonomy).filter((key) => !topLevelKeys.has(key));
  assert(unexpectedTopLevelKeys.length === 0, `catalog/taxonomy.json has unsupported fields: ${unexpectedTopLevelKeys.join(", ")}`);
  assert(taxonomy.version === 1, "catalog/taxonomy.json version must be 1");
  assert(typeof taxonomy.scope === "string" && taxonomy.scope.trim(), "catalog/taxonomy.json must explain its scope");
  assert(
    taxonomy.rigidFamilies && typeof taxonomy.rigidFamilies === "object" && !Array.isArray(taxonomy.rigidFamilies),
    "catalog/taxonomy.json must contain rigidFamilies",
  );

  const familyKeys = new Set(["category", "description", "requiredTags", "requiredAttributes", "identityFields"]);

  for (const [family, rule] of Object.entries(taxonomy.rigidFamilies)) {
    assertKebabLabel(family, `catalog/taxonomy.json: bad family ${family}`);
    assert(rule && typeof rule === "object" && !Array.isArray(rule), `${family}: taxonomy rule must be an object`);

    const unexpectedKeys = Object.keys(rule).filter((key) => !familyKeys.has(key));
    assert(unexpectedKeys.length === 0, `${family}: taxonomy rule has unsupported fields: ${unexpectedKeys.join(", ")}`);
    assertKebabLabel(rule.category, `${family}: taxonomy category must be kebab-case`);
    assert(typeof rule.description === "string" && rule.description.trim(), `${family}: taxonomy rule needs a description`);
    assertStringArray(rule.requiredTags, `${family}: taxonomy requiredTags must be a string array`);
    assertStringArray(rule.requiredAttributes, `${family}: taxonomy requiredAttributes must be a string array`);
    assertOptionalStringArray(rule.identityFields, `${family}: taxonomy identityFields must be a string array`);

    for (const tag of rule.requiredTags) {
      assertKebabLabel(tag, `${family}: bad taxonomy required tag ${tag}`);
    }

    for (const attribute of rule.requiredAttributes) {
      assert(/^[a-z][a-zA-Z0-9]*$/.test(attribute), `${family}: bad taxonomy required attribute ${attribute}`);
    }

    for (const field of rule.identityFields ?? []) {
      assertFieldPath(field, `${family}: bad taxonomy identity field ${field}`);
    }
  }
}

function fieldValue(part, field) {
  if (field === "id" || field === "name" || field === "category" || field === "family") {
    return part[field];
  }

  if (field.startsWith("standard.")) {
    return part.standard?.[field.slice("standard.".length)];
  }

  if (field.startsWith("attributes.")) {
    return part.attributes?.[field.slice("attributes.".length)];
  }

  return undefined;
}

function hasCatalogValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function validateTaxonomyPart(part, taxonomy) {
  const rule = taxonomy.rigidFamilies[part.family];
  if (!rule) {
    return;
  }

  assert(part.category === rule.category, `${part.id}: family ${part.family} must use category ${rule.category}`);

  for (const tag of rule.requiredTags) {
    assert(part.tags.includes(tag), `${part.id}: family ${part.family} requires tag ${tag}`);
  }

  for (const attribute of rule.requiredAttributes) {
    assert(hasCatalogValue(part.attributes[attribute]), `${part.id}: family ${part.family} requires attribute ${attribute}`);
  }

  for (const field of rule.identityFields ?? []) {
    assert(hasCatalogValue(fieldValue(part, field)), `${part.id}: family ${part.family} requires identity field ${field}`);
  }
}

function validateTaxonomyIdentities(parts, taxonomy) {
  for (const [family, rule] of Object.entries(taxonomy.rigidFamilies)) {
    const identityFields = rule.identityFields ?? [];
    if (identityFields.length === 0) {
      continue;
    }

    const identities = new Map();
    for (const part of parts.filter((entry) => entry.family === family)) {
      const identity = JSON.stringify(identityFields.map((field) => fieldValue(part, field)));
      const existing = identities.get(identity);
      assert(!existing, `${part.id}: duplicates ${existing} for rigid family identity ${identityFields.join(", ")}`);
      identities.set(identity, part.id);
    }
  }
}

async function validateStepAsset(part) {
  assert(await exists(stepPathFor(part)), `${part.id}: missing STEP file`);

  const step = await readFile(stepPathFor(part));
  assert(looksLikeStep(step), `${part.id}: STEP file does not look like a STEP file`);
}

async function readBlobAssetMapIfRequired(requireBlob) {
  if (!requireBlob) {
    return null;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required for published Blob preview checks");
  }

  const { list } = await import("@vercel/blob");
  const blobs = new Map();
  let cursor;

  do {
    const page = await list({
      prefix: `${BLOB_ASSET_PREFIX}/`,
      limit: 1000,
      cursor,
    });

    for (const blob of page.blobs) {
      blobs.set(blob.pathname, blob);
    }

    cursor = page.cursor;
    if (!page.hasMore) {
      break;
    }
  } while (cursor);

  return blobs;
}

function validateBlobPreviewAssets(partId, row, blobAssets) {
  if (!blobAssets) {
    return;
  }

  const expected = [
    {
      label: "GLB",
      path: blobAssetPath("glb", partId, row.step_sha256),
    },
    {
      label: "PNG",
      path: blobAssetPath("png", partId, row.step_sha256),
    },
  ];

  for (const asset of expected) {
    const blob = blobAssets.get(asset.path);
    assert(blob, `${partId}: missing Blob ${asset.label} preview asset ${asset.path}`);
    assert(blob.size > 0, `${partId}: Blob ${asset.label} preview asset ${asset.path} is empty`);
  }
}

async function assertPathMissing(filePath, message) {
  assert(!(await exists(filePath)), message);
}

function assertRowsEqual(partId, expected, actual) {
  const keys = Object.keys(expected).sort((a, b) => a.localeCompare(b));
  const actualKeys = Object.keys(actual).sort((a, b) => a.localeCompare(b));
  assert(
    JSON.stringify(actualKeys) === JSON.stringify(keys),
    `${partId}: SQLite row columns do not match expected schema`,
  );

  for (const key of keys) {
    assert(actual[key] === expected[key], `${partId}: SQLite ${key} is stale`);
  }
}

function assertCatalogDbVersion() {
  const db = new DatabaseSync(sqliteCatalogPath, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA user_version").get();
    assert(row.user_version === CATALOG_DB_USER_VERSION, `SQLite user_version must be ${CATALOG_DB_USER_VERSION}`);
  } finally {
    db.close();
  }
}

function asArray(value) {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function splitEntries(entries) {
  return entries.flatMap((entry) => entry.split(",")).map((entry) => entry.trim()).filter(Boolean);
}

function normalizedRepoPath(value) {
  let raw;
  try {
    raw = decodeURIComponent(new URL(value).pathname);
  } catch {
    raw = decodeURIComponent(value.split(/[?#]/, 1)[0]);
  }

  let normalized = raw.replaceAll("\\", "/");
  if (path.isAbsolute(normalized)) {
    normalized = path.relative(process.cwd(), normalized).replaceAll("\\", "/");
  }
  const catalogIndex = normalized.indexOf("catalog/step/");
  if (catalogIndex > 0) {
    normalized = normalized.slice(catalogIndex);
  }

  return normalized.replace(/^\.?\//, "");
}

function stepIdFromCatalogPath(filePath) {
  const normalized = normalizedRepoPath(filePath);
  if (!normalized.startsWith("catalog/step/")) {
    return null;
  }

  const filename = path.posix.basename(normalized);
  const extension = path.posix.extname(filename).toLowerCase();
  if (extension !== ".step" && extension !== ".stp") {
    return null;
  }

  return filename.slice(0, -extension.length);
}

function expectedStepRepoPath(partOrId) {
  const id = typeof partOrId === "string" ? partOrId : partOrId.id;
  return `catalog/step/${id}.step`;
}

function parseLfsPointer(text, filePath) {
  const oid = /^oid sha256:([a-f0-9]{64})$/m.exec(text)?.[1];
  const sizeText = /^size ([0-9]+)$/m.exec(text)?.[1];

  assert(
    text.startsWith("version https://git-lfs.github.com/spec/v1\n") && oid && sizeText,
    `${filePath}: committed STEP must be a Git LFS pointer`,
  );

  const size = Number.parseInt(sizeText, 10);
  assert(Number.isSafeInteger(size) && size >= 0, `${filePath}: invalid Git LFS pointer size`);
  return { oid, size };
}

async function runCommand(command, args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd: process.cwd(),
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if (allowFailure) {
      return null;
    }

    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
    const message = stderr || error.message;
    throw new Error(`${command} ${args.join(" ")} failed: ${message}`);
  }
}

function runCommandWithInput(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout));
        return;
      }

      const message = Buffer.concat(stderr).toString("utf8").trim() || `${command} exited with code ${code}`;
      reject(new Error(`${command} ${args.join(" ")} failed: ${message}`));
    });

    child.stdin.end(input);
  });
}

async function git(args, options) {
  return runCommand("git", args, options);
}

async function readGithubEventPayload() {
  if (!process.env.GITHUB_EVENT_PATH) {
    return null;
  }

  return JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
}

function isZeroSha(value) {
  return typeof value === "string" && /^0+$/.test(value);
}

function eventBaseInfo(eventName, event) {
  if (!event) {
    return null;
  }

  if (eventName === "pull_request") {
    return {
      sha: event.pull_request?.base?.sha,
      ref: event.pull_request?.base?.ref ? `refs/heads/${event.pull_request.base.ref}` : null,
      separator: "...",
      pullRequestHeadCloneUrl: event.pull_request?.head?.repo?.clone_url ?? null,
      pullRequestBaseFullName: event.pull_request?.base?.repo?.full_name ?? null,
      pullRequestHeadFullName: event.pull_request?.head?.repo?.full_name ?? null,
    };
  }

  if (eventName === "merge_group") {
    return {
      sha: event.merge_group?.base_sha,
      ref: event.merge_group?.base_ref ?? null,
      separator: "...",
      pullRequestHeadCloneUrl: null,
      pullRequestBaseFullName: null,
      pullRequestHeadFullName: null,
    };
  }

  if (eventName === "push") {
    return {
      sha: isZeroSha(event.before) ? null : event.before,
      ref: event.ref ?? null,
      separator: "..",
      pullRequestHeadCloneUrl: null,
      pullRequestBaseFullName: null,
      pullRequestHeadFullName: null,
    };
  }

  return null;
}

async function ensureCommitAvailable(sha, fallbackRef) {
  if (!sha) {
    return;
  }

  if (await git(["cat-file", "-e", `${sha}^{commit}`], { allowFailure: true }) !== null) {
    return;
  }

  await git(["fetch", "--no-tags", "--depth=1", "origin", sha], { allowFailure: true });
  if (await git(["cat-file", "-e", `${sha}^{commit}`], { allowFailure: true }) !== null) {
    return;
  }

  if (fallbackRef) {
    await git(["fetch", "--no-tags", "--depth=1", "origin", fallbackRef], { allowFailure: true });
    if (await git(["cat-file", "-e", `${sha}^{commit}`], { allowFailure: true }) !== null) {
      return;
    }
  }

  throw new Error(`${sha}: base commit is unavailable for CI catalog diff`);
}

async function resolveCiBaseInfo() {
  const event = await readGithubEventPayload();
  const info = eventBaseInfo(process.env.GITHUB_EVENT_NAME, event);

  if (!info?.sha) {
    return null;
  }

  await ensureCommitAvailable(info.sha, info.ref);
  return info;
}

async function readChangedCatalogPaths(baseInfo) {
  if (!baseInfo) {
    return [];
  }

  const diffArgs = (range) => [
    "diff",
    "--name-only",
    "--diff-filter=AMR",
    "--find-renames",
    range,
    "--",
    "catalog/step",
    "catalog/parts.json",
  ];

  const range = `${baseInfo.sha}${baseInfo.separator}HEAD`;
  let stdout = await git(diffArgs(range), { allowFailure: true });
  if (stdout === null && baseInfo.separator === "...") {
    stdout = await git(diffArgs(`${baseInfo.sha}..HEAD`));
  }
  assert(stdout !== null, `${range}: unable to read changed catalog paths`);

  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function readBaseSourcePartIds(baseInfo) {
  if (!baseInfo) {
    return new Set();
  }

  const text = await git(["show", `${baseInfo.sha}:catalog/parts.json`], { allowFailure: true });
  if (text === null) {
    return new Set();
  }

  const parts = JSON.parse(text);
  assert(Array.isArray(parts), `${baseInfo.sha}:catalog/parts.json must contain an array`);
  return new Set(parts.map((part) => part.id).filter(Boolean));
}

async function readGitStepPaths() {
  const stdout = await git(["ls-tree", "-r", "--name-only", "HEAD", "catalog/step"]);
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function readGitStepBlobEntries() {
  const stdout = await git(["ls-tree", "-r", "-z", "HEAD", "catalog/step"]);
  return stdout
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const match = /^100644 blob ([a-f0-9]+)\t(.+)$/.exec(entry);
      assert(match, `Unexpected git ls-tree entry: ${entry}`);
      return {
        oid: match[1],
        filePath: match[2],
      };
    });
}

function validateCiStepFileSet(sourceParts, gitStepPaths) {
  const sourceIds = new Set(sourceParts.map((part) => part.id));
  const stepPathsById = new Map();

  for (const filePath of gitStepPaths) {
    const id = stepIdFromCatalogPath(filePath);
    assert(id, `${filePath}: unexpected file in catalog/step`);
    assert(!stepPathsById.has(id), `${filePath}: duplicate STEP asset for ${id}`);
    stepPathsById.set(id, filePath);
  }

  for (const id of sourceIds) {
    const filePath = stepPathsById.get(id);
    assert(filePath, `${id}: missing STEP file`);
    assert(filePath === expectedStepRepoPath(id), `${id}: STEP file must be ${expectedStepRepoPath(id)}`);
  }

  for (const [id, filePath] of stepPathsById) {
    assert(sourceIds.has(id), `${filePath}: orphan STEP file`);
  }
}

async function readStepPointers(sourceParts) {
  const pointers = new Map();
  const entriesByPath = new Map((await readGitStepBlobEntries()).map((entry) => [entry.filePath, entry]));
  const expectedEntries = sourceParts.map((part) => {
    const filePath = expectedStepRepoPath(part);
    const entry = entriesByPath.get(filePath);
    assert(entry, `${part.id}: missing STEP file`);
    return { ...entry, part };
  });
  const output = await runCommandWithInput(
    "git",
    ["cat-file", "--batch"],
    `${expectedEntries.map((entry) => entry.oid).join("\n")}\n`,
  );

  let offset = 0;
  for (const entry of expectedEntries) {
    const headerEnd = output.indexOf(0x0a, offset);
    assert(headerEnd >= 0, `${entry.filePath}: missing git cat-file header`);
    const [oid, objectType, sizeText] = output.subarray(offset, headerEnd).toString("utf8").split(" ");
    const size = Number.parseInt(sizeText, 10);
    assert(oid === entry.oid && objectType === "blob" && Number.isSafeInteger(size), `${entry.filePath}: bad git blob`);

    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    const text = output.subarray(contentStart, contentEnd).toString("utf8");
    pointers.set(entry.part.id, {
      filePath: entry.filePath,
      ...parseLfsPointer(text, entry.filePath),
    });
    offset = contentEnd + 1;
  }

  return pointers;
}

function ciPartFromPointer(sourcePart, pointer, actualRow) {
  assert(actualRow, `${sourcePart.id}: missing SQLite row`);
  assert(/^[a-f0-9]{64}$/.test(actualRow.step_geometry_sha256), `${sourcePart.id}: SQLite step_geometry_sha256 is malformed`);

  return normalizePart({
    ...sourcePart,
    byteSize: pointer.size,
    sha256: pointer.oid,
    stepGeometrySha256: actualRow.step_geometry_sha256,
  });
}

async function resolveCiTargetStepPaths(sourceParts) {
  const targetPaths = new Set(
    splitEntries(asArray(values["changed-step"])).map((entry) => normalizedRepoPath(entry)),
  );
  const baseInfo = await resolveCiBaseInfo();

  for (const filePath of await readChangedCatalogPaths(baseInfo)) {
    if (stepIdFromCatalogPath(filePath)) {
      targetPaths.add(normalizedRepoPath(filePath));
    }
  }

  const baseIds = await readBaseSourcePartIds(baseInfo);
  for (const part of sourceParts) {
    if (!baseIds.has(part.id) && baseInfo) {
      targetPaths.add(expectedStepRepoPath(part));
    }
  }

  return {
    baseInfo,
    targetPaths: Array.from(targetPaths).sort((a, b) => a.localeCompare(b)),
  };
}

function readPositiveIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readOptionalPositiveIntegerEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function enforceCiTargetBudgets(targetParts, pointers) {
  const maxChangedSteps = readOptionalPositiveIntegerEnv("STEP_PARTS_CI_MAX_CHANGED_STEPS");
  const maxStepBytes = readPositiveIntegerEnv("STEP_PARTS_CI_MAX_STEP_BYTES", DEFAULT_CI_MAX_STEP_BYTES);
  const maxTotalStepBytes = readPositiveIntegerEnv("STEP_PARTS_CI_MAX_TOTAL_STEP_BYTES", DEFAULT_CI_MAX_TOTAL_STEP_BYTES);
  const totalBytes = targetParts.reduce((sum, part) => sum + pointers.get(part.id).size, 0);

  if (maxChangedSteps !== null) {
    assert(
      targetParts.length <= maxChangedSteps,
      `CI STEP validation targets ${targetParts.length} files; limit is ${maxChangedSteps}`,
    );
  }

  assert(totalBytes <= maxTotalStepBytes, `CI STEP validation targets ${totalBytes} bytes; limit is ${maxTotalStepBytes}`);

  for (const part of targetParts) {
    const pointer = pointers.get(part.id);
    assert(pointer.size <= maxStepBytes, `${part.id}: STEP file is ${pointer.size} bytes; limit is ${maxStepBytes}`);
  }
}

async function isHydratedStepFile(filePath, pointer) {
  try {
    const bytes = await readFile(path.join(process.cwd(), filePath));
    return bytes.byteLength === pointer.size && createHash("sha256").update(bytes).digest("hex") === pointer.oid;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function ensurePullRequestHeadRemote(baseInfo) {
  if (
    !baseInfo?.pullRequestHeadCloneUrl ||
    !baseInfo.pullRequestHeadFullName ||
    baseInfo.pullRequestHeadFullName === baseInfo.pullRequestBaseFullName
  ) {
    return null;
  }

  const remoteName = "step-parts-pr-head";
  await git(["remote", "remove", remoteName], { allowFailure: true });
  await git(["remote", "add", remoteName, baseInfo.pullRequestHeadCloneUrl]);
  return remoteName;
}

async function fetchAndCheckoutLfsPaths(remote, filePaths) {
  const include = filePaths.join(",");
  await git(["lfs", "install", "--local"]);
  await git(["lfs", "fetch", "--include", include, "--exclude", "", remote, "HEAD"]);
  await git(["lfs", "checkout", ...filePaths]);
}

function conciseCommandError(error) {
  const message = String(error?.message ?? error);
  const marker = " failed: ";
  const markerIndex = message.indexOf(marker);
  return markerIndex >= 0 ? message.slice(markerIndex + marker.length) : message;
}

function encodeGithubPath(filePath) {
  return filePath.split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function downloadGithubMediaStepFiles(filePaths) {
  const repository = process.env.GITHUB_REPOSITORY;
  assert(
    repository && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository),
    "GITHUB_REPOSITORY is required for GitHub media STEP hydration fallback",
  );

  const ref = process.env.GITHUB_SHA || (await git(["rev-parse", "HEAD"])).trim();
  const headers = {};
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  for (const filePath of filePaths) {
    const url = `https://media.githubusercontent.com/media/${repository}/${encodeURIComponent(ref)}/${encodeGithubPath(filePath)}`;
    const response = await fetch(url, { headers });
    assert(response.ok, `${filePath}: GitHub media download failed with ${response.status} ${response.statusText}`);
    await writeFile(path.join(process.cwd(), filePath), Buffer.from(await response.arrayBuffer()));
  }
}

async function hydrateCiStepFiles(targetParts, pointers, baseInfo) {
  const missingPaths = [];
  for (const part of targetParts) {
    const pointer = pointers.get(part.id);
    if (!(await isHydratedStepFile(pointer.filePath, pointer))) {
      missingPaths.push(pointer.filePath);
    }
  }

  if (missingPaths.length === 0) {
    return;
  }

  const remotes = ["origin"];
  const pullRequestHeadRemote = await ensurePullRequestHeadRemote(baseInfo);
  if (pullRequestHeadRemote) {
    remotes.push(pullRequestHeadRemote);
  }

  const errors = [];
  for (const remote of remotes) {
    try {
      await fetchAndCheckoutLfsPaths(remote, missingPaths);
      const stillMissing = [];
      for (const part of targetParts) {
        const pointer = pointers.get(part.id);
        if (!(await isHydratedStepFile(pointer.filePath, pointer))) {
          stillMissing.push(pointer.filePath);
        }
      }
      if (stillMissing.length === 0) {
        return;
      }
      errors.push(`${remote}: ${stillMissing.length} LFS files remained as pointers after checkout`);
    } catch (error) {
      errors.push(`${remote}: ${conciseCommandError(error)}`);
    }
  }

  try {
    await downloadGithubMediaStepFiles(missingPaths);
    const stillMissing = [];
    for (const part of targetParts) {
      const pointer = pointers.get(part.id);
      if (!(await isHydratedStepFile(pointer.filePath, pointer))) {
        stillMissing.push(pointer.filePath);
      }
    }
    if (stillMissing.length === 0) {
      return;
    }
    errors.push(`GitHub media: ${stillMissing.length} downloaded files did not match their LFS pointers`);
  } catch (error) {
    errors.push(`GitHub media: ${conciseCommandError(error)}`);
  }

  throw new Error(`Unable to hydrate CI STEP files:\n${errors.join("\n")}`);
}

function flattenNumbers(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const result = [];
  const walk = (entry) => {
    if (Array.isArray(entry)) {
      for (const item of entry) {
        walk(item);
      }
      return;
    }

    result.push(Number(entry));
  };
  walk(value);
  return result;
}

function hasRenderableMesh(result) {
  return Boolean(
    result?.meshes?.some((mesh) => flattenNumbers(mesh.attributes?.position?.array).length >= 9),
  );
}

async function validateStepImport(part, occt) {
  const step = await readFile(stepPathFor(part));
  const result = occt.ReadStepFile(step, {
    linearUnit: "millimeter",
    linearDeflectionType: "bounding_box_ratio",
    linearDeflection: 0.0008,
    angularDeflection: 0.35,
  });

  assert(result.success, `${part.id}: STEP import failed`);
  assert(hasRenderableMesh(result), `${part.id}: no renderable meshes were produced`);
}

const errors = [];

async function collect(label, task) {
  try {
    await task();
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
  }
}

const sourceParts = await readSourceParts();
const taxonomy = await readTaxonomy();
const ciMode = Boolean(values.ci);
const ciStepContentMode = ciMode && Boolean(values["ci-step-content"]);
const expectedParts = [];
const sourceMetadataParts = [];
let ciBaseInfo = null;
let ciStepPointers = new Map();
let ciTargetParts = [];
let ciStepHydrated = false;

assert(!values["ci-step-content"] || ciMode, "--ci-step-content requires --ci");

await collect("catalog/taxonomy.json", () => {
  validateTaxonomy(taxonomy);
});

await collect("catalog/parts.sqlite", () => {
  assertCatalogDbVersion();
});

const actualRows = new Map();
await collect("catalog/parts.sqlite rows", () => {
  for (const row of readCatalogRows()) {
    assert(!actualRows.has(row.id), `${row.id}: duplicate SQLite row`);
    actualRows.set(row.id, row);
  }
  assert(actualRows.size === sourceParts.length, `SQLite catalog has ${actualRows.size} rows; expected ${sourceParts.length}`);
});

if (ciMode) {
  await collect("catalog/step file set", async () => {
    validateCiStepFileSet(sourceParts, await readGitStepPaths());
  });

  await collect("Git LFS pointers", async () => {
    ciStepPointers = await readStepPointers(sourceParts);
  });

  if (ciStepContentMode) {
    await collect("CI STEP validation targets", async () => {
      const { baseInfo, targetPaths } = await resolveCiTargetStepPaths(sourceParts);
      ciBaseInfo = baseInfo;

      const sourcePartsById = new Map(sourceParts.map((part) => [part.id, part]));
      const targetIds = new Set();
      for (const filePath of targetPaths) {
        const id = stepIdFromCatalogPath(filePath);
        assert(id, `${filePath}: --changed-step must point at catalog/step/*.step or catalog/step/*.stp`);
        assert(sourcePartsById.has(id), `${filePath}: changed STEP does not have a source catalog record`);
        targetIds.add(id);
      }

      ciTargetParts = sourceParts.filter((part) => targetIds.has(part.id));
      for (const part of ciTargetParts) {
        assert(ciStepPointers.has(part.id), `${part.id}: missing Git LFS pointer`);
      }
      enforceCiTargetBudgets(ciTargetParts, ciStepPointers);
    });
  }
} else {
  await collect("STEP metadata", async () => {
    const result = await checkStepMetadataForCatalogParts(sourceParts, { stepDir });
    assert(result.errors.length === 0, result.errors.slice(0, 80).join("\n"));
  });
}

for (const sourcePart of sourceParts) {
  await collect(sourcePart.id ?? "<unknown>", async () => {
    if (ciMode) {
      const pointer = ciStepPointers.get(sourcePart.id);
      assert(pointer, `${sourcePart.id}: missing Git LFS pointer`);
      sourceMetadataParts.push(ciPartFromPointer(sourcePart, pointer, actualRows.get(sourcePart.id)));
      return;
    }

    sourceMetadataParts.push(await materializePart(sourcePart));
  });
}

const sourceMetadataById = new Map(sourceMetadataParts.map((part) => [part.id, part]));
const ids = new Set();
for (const part of sourceMetadataParts) {
  await collect(part.id, async () => {
    validatePart(part, ids);
    validateTaxonomyPart(part, taxonomy);
  });
}

for (const sourcePart of sourceParts) {
  const part = sourceMetadataById.get(sourcePart.id);
  assert(part, `${sourcePart.id}: missing materialized source metadata`);
  expectedParts.push(part);
}

await collect("catalog/taxonomy.json identities", () => {
  validateTaxonomyIdentities(expectedParts, taxonomy);
});

if (ciStepContentMode && ciTargetParts.length > 0) {
  await collect("CI STEP LFS hydration", async () => {
    await hydrateCiStepFiles(ciTargetParts, ciStepPointers, ciBaseInfo);
    ciStepHydrated = true;
  });

  if (ciStepHydrated) {
    await collect("CI STEP metadata", async () => {
      const result = await checkStepMetadataForCatalogParts(ciTargetParts, { stepDir });
      assert(result.errors.length === 0, result.errors.slice(0, 80).join("\n"));
    });

    const { default: occtImport } = await import("occt-import-js");
    const occt = await occtImport();

    for (const sourcePart of ciTargetParts) {
      await collect(sourcePart.id, async () => {
        await validateStepAsset(sourcePart);
        await validateStepImport(sourcePart, occt);
        const fullPart = await materializePart(sourcePart);
        sourceMetadataById.set(sourcePart.id, fullPart);
      });
    }
  }
} else if (!ciMode) {
  for (const part of expectedParts) {
    await collect(part.id, async () => {
      await validateStepAsset(part);
    });
  }
}

const blobAssets = await readBlobAssetMapIfRequired(Boolean(values["require-blob"]));

for (const [sourceOrder, part] of expectedParts.entries()) {
  await collect(`catalog/parts.sqlite:${part.id}`, async () => {
    const actual = actualRows.get(part.id);
    assert(actual, `${part.id}: missing SQLite row`);
    const expectedPart = sourceMetadataById.get(part.id);
    assert(expectedPart, `${part.id}: missing materialized source metadata`);
    const expected = catalogRowFromPart(expectedPart, { sourceOrder });
    assertRowsEqual(part.id, expected, actual);
    validateBlobPreviewAssets(part.id, expected, blobAssets);
  });
}

await collect("public/catalog/parts.json", () =>
  assertPathMissing(obsoletePublicCatalogJsonPath, "public/catalog/parts.json is obsolete; source catalog belongs in catalog/parts.json"),
);
await collect("public/catalog/parts.sqlite", () =>
  assertPathMissing(obsoletePublicCatalogSqlitePath, "public/catalog/parts.sqlite is obsolete; generated catalog database belongs in catalog/parts.sqlite"),
);
await collect("public/catalog/parts.source.json", () =>
  assertPathMissing(obsoleteSourceCatalogPath, "public/catalog/parts.source.json is obsolete; source catalog belongs in catalog/parts.json"),
);
await collect("public/catalog/parts.ndjson", () =>
  assertPathMissing(obsoleteCatalogNdjsonPath, "public/catalog/parts.ndjson is obsolete; generated catalog metadata belongs in catalog/parts.sqlite"),
);
await collect("public/catalog/manifest.json", () =>
  assertPathMissing(obsoleteAssetManifestPath, "public/catalog/manifest.json is obsolete; preview asset paths are derived from STEP SHA-256"),
);
await collect("catalog/manifest.json", () =>
  assertPathMissing(path.join(process.cwd(), "catalog", "manifest.json"), "catalog/manifest.json is obsolete; preview asset paths are derived from STEP SHA-256"),
);
await collect("catalog/parts.source.json", () =>
  assertPathMissing(path.join(process.cwd(), "catalog", "parts.source.json"), "catalog/parts.source.json is obsolete; source catalog belongs in catalog/parts.json"),
);
await collect("public/parts", () =>
  assertPathMissing(path.join(process.cwd(), "public", "parts"), "public/parts is obsolete; canonical STEP assets belong in catalog/step and previews belong in Vercel Blob"),
);
await collect("public/step", () =>
  assertPathMissing(path.join(process.cwd(), "public", "step"), "public/step is obsolete; canonical STEP assets belong in catalog/step"),
);

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Checked ${expectedParts.length} catalog parts and generated metadata${blobAssets ? "/Blob assets" : ""}.`);
