import { apiOptions } from "@/lib/api-response";
import { partResponse } from "@/lib/part-api";

type PartRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export function OPTIONS() {
  return apiOptions();
}

export async function GET(_request: Request, { params }: PartRouteContext) {
  const { id } = await params;
  return partResponse(id);
}
