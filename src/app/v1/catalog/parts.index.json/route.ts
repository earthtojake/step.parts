import { apiOptions } from "@/lib/api-response";
import { jsonWithFreshness } from "@/lib/catalog-metadata";
import { buildPartsIndex } from "@/lib/parts-index";

export function OPTIONS() {
  return apiOptions();
}

export function GET() {
  return jsonWithFreshness(buildPartsIndex(), "catalog-parts-index");
}
