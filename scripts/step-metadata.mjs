import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const STEP_PARTS_METADATA_REPORT_PATH = "/tmp/step-parts-metadata-report.json";

const MARKER_TITLE = "step.parts distribution metadata";
const MARKER_PATTERN = /\/\* step\.parts distribution metadata[\s\S]*?\*\/\r?\n?/g;

function stepPartsPartUrl(id) {
  return `https://www.step.parts/parts/${id}`;
}

export function stepPartsDistributionMarker(id) {
  return `/* ${MARKER_TITLE}
 * Distributed by step.parts: ${stepPartsPartUrl(id)}
 * Canonical STEP asset: ${id}.step
 */
`;
}

function headerWithoutExistingMarker(header) {
  return header.replace(MARKER_PATTERN, "");
}

function splitStepText(text) {
  const dataIndex = text.indexOf("DATA;");
  if (dataIndex === -1) {
    throw new Error("missing DATA section");
  }

  return {
    header: text.slice(0, dataIndex),
    data: text.slice(dataIndex),
  };
}

export function stepDataSectionSha256(bytes) {
  const dataIndex = bytes.indexOf("DATA;");
  const dataBytes = dataIndex === -1 ? bytes : bytes.subarray(dataIndex);
  return createHash("sha256").update(dataBytes).digest("hex");
}

function ensureMarkerInHeader(id, originalHeader) {
  const marker = stepPartsDistributionMarker(id);
  const header = headerWithoutExistingMarker(originalHeader);
  const match = /HEADER;\s*/i.exec(header);
  if (!match) {
    throw new Error("missing HEADER statement");
  }

  const insertAt = match.index + match[0].length;
  return `${header.slice(0, insertAt)}${marker}${header.slice(insertAt)}`;
}

export function normalizeStepMetadataText(part, text) {
  const { header, data } = splitStepText(text);
  return `${ensureMarkerInHeader(part.id, header)}${data}`;
}

function hasCurrentMetadata(part, text) {
  return normalizeStepMetadataText(part, text) === text;
}

function dataHashForText(text) {
  return createHash("sha256").update(splitStepText(text).data).digest("hex");
}

export async function ensureStepMetadataForCatalogParts(parts, { stepDir, write }) {
  const changed = [];
  const unchanged = [];
  const errors = [];

  for (const part of parts) {
    const filePath = path.join(stepDir, `${part.id}.step`);

    try {
      const before = await readFile(filePath, "utf8");
      const beforeDataHash = dataHashForText(before);
      const after = normalizeStepMetadataText(part, before);
      const afterDataHash = dataHashForText(after);

      if (beforeDataHash !== afterDataHash) {
        throw new Error("normalization changed DATA section bytes");
      }

      if (after !== before) {
        if (write) {
          await writeFile(filePath, after);
        }
        changed.push(part.id);
      } else {
        unchanged.push(part.id);
      }
    } catch (error) {
      errors.push({
        id: part.id,
        file: filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { changed, unchanged, errors };
}

export async function checkStepMetadataForCatalogParts(parts, { stepDir }) {
  const errors = [];

  for (const part of parts) {
    const filePath = path.join(stepDir, `${part.id}.step`);

    try {
      const text = await readFile(filePath, "utf8");
      if (!hasCurrentMetadata(part, text)) {
        errors.push(`${part.id}: STEP header metadata is stale or missing`);
      }
    } catch (error) {
      errors.push(`${part.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { errors };
}

export async function writeStepMetadataReport(report) {
  await mkdir(path.dirname(STEP_PARTS_METADATA_REPORT_PATH), { recursive: true });
  await writeFile(STEP_PARTS_METADATA_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  return STEP_PARTS_METADATA_REPORT_PATH;
}
