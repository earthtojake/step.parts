import type { NextRequest } from "next/server";
import { apiOptions } from "@/lib/api-response";
import { listPartsResponse } from "@/lib/part-api";

export function OPTIONS() {
  return apiOptions();
}

export function GET(request: NextRequest) {
  return listPartsResponse(request);
}
