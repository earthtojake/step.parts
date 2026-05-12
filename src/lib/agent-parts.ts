import type { Part } from "@/types/part";
import { absoluteUrl, apiUrl } from "@/lib/site";

export type AgentPart = Omit<Part, "stepUrl" | "glbUrl" | "pngUrl"> & {
  pageUrl: string;
  apiUrl: string;
  downloadUrl: string;
  stepUrl: string;
  glbUrl: string;
  pngUrl: string;
};

export function partPagePath(part: Pick<Part, "id">) {
  return `/parts/${part.id}`;
}

export function describePart(part: Part) {
  return part.description;
}

export function serializePartForAgent(part: Part): AgentPart {
  return {
    ...part,
    pageUrl: absoluteUrl(partPagePath(part)),
    apiUrl: apiUrl(`/v1/parts/${part.id}`),
    downloadUrl: apiUrl(`/v1/parts/${part.id}/download`),
    stepUrl: part.stepUrl,
    glbUrl: absoluteUrl(part.glbUrl),
    pngUrl: absoluteUrl(part.pngUrl),
  };
}

export function serializePartsForAgent(parts: Part[]) {
  return parts.map((part) => serializePartForAgent(part));
}

export function getUniqueTags(parts: Part[]) {
  return Array.from(new Set(parts.flatMap((part) => part.tags))).sort((a, b) => a.localeCompare(b));
}
