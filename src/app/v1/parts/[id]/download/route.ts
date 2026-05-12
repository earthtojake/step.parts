import { apiOptions } from "@/lib/api-response";
import { singlePartDownloadResponse } from "@/lib/part-api";

export const runtime = "nodejs";

type PartDownloadRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export function OPTIONS() {
  return apiOptions();
}

export async function GET(request: Request, { params }: PartDownloadRouteContext) {
  const { id } = await params;
  return singlePartDownloadResponse(request, id);
}
