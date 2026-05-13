import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import {
  ensureAssetDirs,
  exists,
  looksLikeStep,
  normalizePart,
  normalizeSourcePart,
  readSourceParts,
  sourceCatalogPath,
  stepPathFor,
  writeSourceCatalogFile,
} from "./catalog-utils.mjs";

const { values } = parseArgs({
  allowPositionals: false,
  options: {
    help: { type: "boolean", short: "h" },
    step: { type: "string" },
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    category: { type: "string" },
    family: { type: "string" },
    tag: { type: "string", multiple: true },
    alias: { type: "string", multiple: true },
    standard: { type: "string" },
    "standard-body": { type: "string" },
    "standard-number": { type: "string" },
    "standard-designation": { type: "string" },
    "step-source": { type: "string" },
    "product-page": { type: "string" },
    attr: { type: "string", multiple: true },
    attribute: { type: "string", multiple: true },
    "dry-run": { type: "boolean" },
  },
});

function printHelp() {
  console.log(`Add a STEP part to the source catalog.

Usage:
  npm run catalog:add
  npm run catalog:add -- --step ./part.step --name "ISO 4762 socket head cap screw, M3 x 12" \\
    --category fastener --family socket-head-cap-screw --tag screw --tag socket-head --tag metric \\
    --standard "ISO 4762" --attr thread=M3 --attr lengthMm=12

Options:
  --step <path>                   Local STEP file path
  --id <snake_case_id>            Optional id; defaults to a slug from --name
  --name <name>                   Human-readable part name
  --description <description>     Searchable one-sentence description
  --category <label>              Kebab-case broad category
  --family <label>                Optional kebab-case part family
  --tag <tag>                     Repeatable or comma-separated supplemental type/feature tags
  --alias <alias>                 Repeatable or comma-separated aliases
  --standard <designation>        Standard designation such as "ISO 4762"
  --standard-body <body>          Override parsed standard body
  --standard-number <number>      Override parsed standard number
  --standard-designation <text>   Override standard designation
  --step-source <url>             Direct STEP/STP source URL
  --product-page <url>            Product page for the source STEP file
  --attr <key=value>              Repeatable part attributes
  --dry-run                       Validate and preview without writing files
`);
}

if (values.help) {
  printHelp();
  process.exit(0);
}

function asArray(value) {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function splitList(entries) {
  return entries.flatMap((entry) => entry.split(",")).map((entry) => entry.trim()).filter(Boolean);
}

function slugifyId(value) {
  const id = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  return id || "part";
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSnakeId(id) {
  assert(/^[a-z0-9_]+$/.test(id), "Part id must be snake_case ASCII");
}

function assertKebabLabel(value, label) {
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value), `${label} must be kebab-case ASCII`);
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

function assertSupplementalTags(part) {
  const seen = new Set();
  const reservedValues = [
    part.category,
    part.family,
    part.id,
    part.name,
    ...(part.aliases ?? []),
    part.standard?.designation,
    part.standard ? `${part.standard.body}${part.standard.number}` : "",
    part.attributes.model,
    part.attributes.manufacturer,
    part.attributes.sku,
  ];
  const reserved = new Set(reservedValues.filter(Boolean).flatMap((value) => [normalizeTagValue(value), compactTagValue(value)]));
  const reservedMetadataTags = new Set(["official-step", "community-step"]);

  for (const tag of part.tags) {
    assertKebabLabel(tag, `Tag ${tag}`);
    assert(!seen.has(tag), `Duplicate tag: ${tag}`);
    assert(!reservedMetadataTags.has(tag), `${tag} belongs in dedicated metadata fields, not tags`);
    assert(!reserved.has(tag), `${tag} duplicates another catalog field`);
    seen.add(tag);
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function expandLocalPath(value) {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return path.resolve(value);
}

function parseScalar(value) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === "null") {
    return null;
  }

  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}

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

function parseAttributes(entries) {
  const attributes = {};
  for (const entry of entries) {
    const separatorIndex = entry.indexOf("=");
    assert(separatorIndex > 0, `Attribute must use key=value syntax: ${entry}`);

    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();
    assert(/^[a-z][a-zA-Z0-9]*$/.test(key), `Attribute key must be camelCase ASCII: ${key}`);
    assert(
      key !== "stepSource" && key !== "productPage" && !key.startsWith("source") && !PROVENANCE_ATTRIBUTE_KEYS.has(key),
      `${key} is source/provenance bookkeeping and does not belong in attributes`,
    );
    attributes[key] = parseScalar(value);
  }

  return attributes;
}

function validateOptionalUrl(value, label) {
  if (!value) {
    return null;
  }

  assert(value.trim() === value, `${label} must not have leading or trailing whitespace`);
  assert(isHttpUrl(value), `${label} must be an HTTP(S) URL`);
  return value;
}

function validateOptionalStepSource(value) {
  const url = validateOptionalUrl(value, "Step source");
  if (!url) {
    return null;
  }

  const pathname = new URL(url).pathname.toLowerCase();
  assert(pathname.endsWith(".step") || pathname.endsWith(".stp"), "Step source must link directly to a STEP/STP file");
  return url;
}

function parseStandardFromDesignation(designation) {
  const trimmed = designation.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^([A-Za-z]+)\s+(.+)$/);
  if (!match) {
    return {
      body: "",
      number: "",
      designation: trimmed,
    };
  }

  return {
    body: match[1].toUpperCase(),
    number: match[2].trim(),
    designation: trimmed,
  };
}

function standardFromFlags() {
  const designation = values["standard-designation"] ?? values.standard ?? "";
  const parsed = parseStandardFromDesignation(designation);
  const body = values["standard-body"] ?? parsed?.body ?? "";
  const number = values["standard-number"] ?? parsed?.number ?? "";
  const finalDesignation = values["standard-designation"] ?? parsed?.designation ?? (body && number ? `${body} ${number}` : "");

  if (!body && !number && !finalDesignation) {
    return null;
  }

  assert(body, "Standard body is required when a standard is provided");
  assert(number, "Standard number is required when a standard is provided");
  assert(finalDesignation, "Standard designation is required when a standard is provided");

  return {
    body,
    number,
    designation: finalDesignation,
  };
}

function summarizeExisting(values) {
  const unique = Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  if (unique.length === 0) {
    return "";
  }

  const preview = unique.slice(0, 10).join(", ");
  return unique.length > 10 ? `${preview}, ...` : preview;
}

async function question(rl, label, defaultValue = "") {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function requiredInput(rl, label, currentValue, defaultValue = "") {
  if (currentValue) {
    return currentValue;
  }

  if (!input.isTTY) {
    throw new Error(`Missing required option: ${label}`);
  }

  while (true) {
    const answer = await question(rl, label, defaultValue);
    if (answer) {
      return answer;
    }
  }
}

async function loadStepBytes(stepInput) {
  if (isHttpUrl(stepInput)) {
    throw new Error("--step must be a local STEP/STP file path");
  }

  const localPath = expandLocalPath(stepInput);
  const bytes = await readFile(localPath);
  if (!looksLikeStep(bytes)) {
    throw new Error(`${localPath} does not look like a STEP file`);
  }

  return {
    bytes,
    source: localPath,
  };
}

function previewGeneratedPart(sourcePart, stepBytes) {
  if (!stepBytes) {
    return normalizePart(sourcePart);
  }

  return normalizePart({
    ...sourcePart,
    byteSize: stepBytes.byteLength,
    sha256: createHash("sha256").update(stepBytes).digest("hex"),
  });
}

function runNodeScript(scriptPath, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${scriptPath} exited with code ${code}`));
    });
  });
}

async function main() {
  const dryRun = Boolean(values["dry-run"]);
  const existingParts = await readSourceParts();
  const existingIds = new Set(existingParts.map((part) => part.id));
  const rl = input.isTTY ? createInterface({ input, output }) : null;

  try {
    const stepInput = await requiredInput(rl, "STEP file path", values.step);
    const name = await requiredInput(rl, "Part name", values.name);
    const description = await requiredInput(rl, "Description", values.description, `${name}.`);
    const defaultId = slugifyId(name);
    let id = values.id ?? "";

    if (!id) {
      if (!rl) {
        id = defaultId;
      } else {
        while (true) {
          id = await question(rl, "Part id", defaultId);
          try {
            assertSnakeId(id);
            assert(!existingIds.has(id), `${id}: duplicate part id`);
            break;
          } catch (error) {
            console.error(error.message);
          }
        }
      }
    }

    assertSnakeId(id);
    assert(!existingIds.has(id), `${id}: duplicate part id`);

    const categoryHint = summarizeExisting(existingParts.map((part) => part.category));
    const familyHint = summarizeExisting(existingParts.map((part) => part.family));
    const categoryLabel = categoryHint ? `Category [existing: ${categoryHint}]` : "Category";
    const familyLabel = familyHint ? `Family [existing: ${familyHint}]` : "Family";
    const category = await requiredInput(rl, categoryLabel, values.category);
    const family = values.family ?? (rl ? await question(rl, familyLabel) : "");
    assertKebabLabel(category, "Category");
    if (family) {
      assertKebabLabel(family, "Family");
    }

    const tagEntries = splitList(asArray(values.tag));
    const interactiveTags =
      tagEntries.length > 0 || !rl
        ? tagEntries
        : splitList([await requiredInput(rl, "Supplemental tags, comma-separated")]);
    assert(interactiveTags.length > 0, "At least one tag is required");

    const aliasEntries = splitList(asArray(values.alias));
    const aliases =
      aliasEntries.length > 0 || !rl ? aliasEntries : splitList([await question(rl, "Aliases, comma-separated")]);

    let standard = standardFromFlags();
    if (!standard && rl) {
      const designation = await question(rl, "Standard designation, optional");
      const parsed = parseStandardFromDesignation(designation);
      if (parsed) {
        const body = parsed.body || (await question(rl, "Standard body"));
        const number = parsed.number || (await question(rl, "Standard number"));
        assert(body, "Standard body is required when a standard is provided");
        assert(number, "Standard number is required when a standard is provided");
        standard = {
          body,
          number,
          designation: parsed.designation,
        };
      }
    }

    const attrEntries = splitList([...asArray(values.attr), ...asArray(values.attribute)]);
    const attributes =
      attrEntries.length > 0 || !rl
        ? parseAttributes(attrEntries)
        : parseAttributes(splitList([await question(rl, "Attributes key=value, comma-separated")]));
    const stepSource = validateOptionalStepSource(values["step-source"]);
    const productPage = validateOptionalUrl(values["product-page"], "Product page");

    const sourcePart = normalizeSourcePart({
      id,
      name,
      description,
      category,
      family,
      tags: interactiveTags,
      aliases,
      ...(standard ? { standard } : {}),
      ...(stepSource ? { stepSource } : {}),
      ...(productPage ? { productPage } : {}),
      attributes,
    });
    assertSupplementalTags(sourcePart);

    const step = await loadStepBytes(stepInput);
    const destination = stepPathFor(sourcePart);

    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            sourceRecord: sourcePart,
            generatedPreview: previewGeneratedPart(sourcePart, step.bytes),
            step: {
              source: step.source,
              destination,
              wouldWrite: false,
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    await ensureAssetDirs();
    if (await exists(destination)) {
      throw new Error(`${id}: STEP file already exists at ${destination}`);
    }

    await writeFile(destination, step.bytes);
    await writeSourceCatalogFile([...existingParts, sourcePart]);
    console.log(`Added ${id} to ${sourceCatalogPath}`);

    await runNodeScript("scripts/generate-catalog.mjs");
    await runNodeScript("scripts/export-assets.mjs", ["--targets", id]);
    await runNodeScript("scripts/check-catalog.mjs");
  } finally {
    rl?.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
