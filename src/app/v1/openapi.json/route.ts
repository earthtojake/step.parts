import { apiOptions } from "@/lib/api-response";
import { freshnessHeaders } from "@/lib/catalog-metadata";
import { buildOpenApiSpec } from "@/lib/openapi";

export function OPTIONS() {
  return apiOptions();
}

export function GET() {
  return Response.json(buildOpenApiSpec(), {
    headers: freshnessHeaders("openapi"),
  });
}
