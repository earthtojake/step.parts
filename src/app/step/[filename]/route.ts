import { readFile } from "node:fs/promises";
import { apiHeaders, apiJson, apiOptions } from "@/lib/api-response";
import { githubStepAssetsEnabled, githubStepUrlForId, localStepPathForId } from "@/lib/part-download";
import { getPart } from "@/lib/parts";

export const runtime = "nodejs";

type StepRouteContext = {
  params: Promise<{
    filename: string;
  }>;
};

function jsonError(message: string, status: number) {
  return apiJson({ error: message }, { status });
}

function partIdFromFilename(filename: string) {
  return /^[a-z0-9_]+\.step$/.test(filename) ? filename.slice(0, -".step".length) : null;
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

function responseBody(data: Uint8Array) {
  const body = new ArrayBuffer(data.byteLength);
  new Uint8Array(body).set(data);
  return body;
}

export function OPTIONS() {
  return apiOptions();
}

export async function GET(_request: Request, { params }: StepRouteContext) {
  const { filename } = await params;
  const partId = partIdFromFilename(filename);

  if (!partId || !getPart(partId)) {
    return jsonError("Part not found", 404);
  }

  if (githubStepAssetsEnabled()) {
    return redirectResponse(githubStepUrlForId(partId));
  }

  const data = await readFile(localStepPathForId(partId));

  return new Response(responseBody(data), {
    headers: apiHeaders({
      "Cache-Control": "public, max-age=3600",
      "Content-Length": String(data.byteLength),
      "Content-Type": "model/step",
    }),
  });
}
