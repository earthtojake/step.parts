import { apiOptions } from "@/lib/api-response";
import { freshnessHeaders } from "@/lib/catalog-metadata";
import { buildCatalogSchema } from "@/lib/catalog-schema";

export function OPTIONS() {
  return apiOptions();
}

export function GET() {
  return Response.json(buildCatalogSchema(), {
    headers: freshnessHeaders("catalog-schema"),
  });
}
