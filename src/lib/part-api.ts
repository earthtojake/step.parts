import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { NextRequest } from "next/server";
import { serializePartForAgent } from "@/lib/agent-parts";
import { apiHeaders, apiJson } from "@/lib/api-response";
import { githubStepAssetsEnabled, githubStepUrlForId, localStepPathForId } from "@/lib/part-download";
import { stepFileName } from "@/lib/part-files";
import { queryParts } from "@/lib/part-query";
import { incrementPartDownload } from "@/lib/part-stats";
import { getPart } from "@/lib/parts";

function jsonError(message: string, status: number) {
  return apiJson({ error: message }, { status });
}

function clientIdentifier(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function rankingDedupeKey(request: Request) {
  return createHash("sha256").update(clientIdentifier(request)).digest("hex");
}

function responseBody(data: Uint8Array) {
  const body = new ArrayBuffer(data.byteLength);
  new Uint8Array(body).set(data);
  return body;
}

function stepResponse(data: Uint8Array, partId: string) {
  return new Response(responseBody(data), {
    headers: apiHeaders({
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${stepFileName(partId)}"`,
      "Content-Length": String(data.byteLength),
      "Content-Type": "model/step",
    }),
  });
}

function redirectResponse(location: string) {
  return new Response(null, {
    status: 302,
    headers: apiHeaders({
      "Cache-Control": "no-store",
      Location: location,
    }),
  });
}

async function readLocalStep(partId: string) {
  return new Uint8Array(await readFile(localStepPathForId(partId)));
}

export async function listPartsResponse(request: NextRequest) {
  return apiJson(await queryParts(request.nextUrl.searchParams), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function partResponse(partId: string) {
  const part = getPart(partId);

  if (!part) {
    return jsonError("Part not found", 404);
  }

  return apiJson(serializePartForAgent(part), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function singlePartDownloadResponse(request: Request, partId: string) {
  const part = getPart(partId);

  if (!part) {
    return jsonError("Part not found", 404);
  }

  await incrementPartDownload(part.id, rankingDedupeKey(request));

  if (githubStepAssetsEnabled()) {
    return redirectResponse(githubStepUrlForId(part.id));
  }

  return stepResponse(await readLocalStep(part.id), part.id);
}
