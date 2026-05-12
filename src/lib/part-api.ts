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

const DOWNLOAD_RATE_LIMIT_WINDOW_MS = 60_000;

const DOWNLOAD_RATE_LIMITS = {
  single: 120,
} as const;
const DOWNLOAD_RATE_LIMIT_CLEANUP_SIZE = 10_000;

type DownloadRateLimitKind = keyof typeof DOWNLOAD_RATE_LIMITS;
type DownloadRateLimitBucket = {
  count: number;
  resetAt: number;
};

const globalDownloadRateLimits = globalThis as typeof globalThis & {
  __stepPartsDownloadRateLimits?: Map<string, DownloadRateLimitBucket>;
};

const downloadRateLimits = (globalDownloadRateLimits.__stepPartsDownloadRateLimits ??= new Map());

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

function downloadRateLimitResponse(resetAt: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));

  return apiJson(
    { error: "Too many download requests. Try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}

function checkDownloadRateLimit(request: Request, kind: DownloadRateLimitKind) {
  const now = Date.now();

  if (downloadRateLimits.size > DOWNLOAD_RATE_LIMIT_CLEANUP_SIZE) {
    for (const [key, bucket] of downloadRateLimits) {
      if (bucket.resetAt <= now) {
        downloadRateLimits.delete(key);
      }
    }
  }

  const key = `${kind}:${clientIdentifier(request)}`;
  const current = downloadRateLimits.get(key);

  if (!current || current.resetAt <= now) {
    downloadRateLimits.set(key, {
      count: 1,
      resetAt: now + DOWNLOAD_RATE_LIMIT_WINDOW_MS,
    });
    return null;
  }

  if (current.count >= DOWNLOAD_RATE_LIMITS[kind]) {
    return downloadRateLimitResponse(current.resetAt);
  }

  current.count += 1;
  return null;
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

  const rateLimitResponse = checkDownloadRateLimit(request, "single");
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  await incrementPartDownload(part.id, rankingDedupeKey(request));

  if (githubStepAssetsEnabled()) {
    return redirectResponse(githubStepUrlForId(part.id));
  }

  return stepResponse(await readLocalStep(part.id), part.id);
}
