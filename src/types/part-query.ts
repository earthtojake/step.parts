import type { AgentPart } from "@/lib/agent-parts";

export type PartFacet = {
  value: string;
  count: number;
};

export type PartQueryFilters = {
  q: string;
  tags: string[];
  categories: string[];
  families: string[];
  standards: string[];
};

export type PartQueryFacets = {
  tags: PartFacet[];
  categories: PartFacet[];
  families: PartFacet[];
  standards: PartFacet[];
};

export type CatalogInfo = {
  partCount: number;
  lastModified: string;
  sha256: string;
  schemaUrl: string;
  openApiUrl: string;
};

export type PartQueryResult = {
  catalog: CatalogInfo;
  items: AgentPart[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  facets: PartQueryFacets;
  filters: PartQueryFilters;
};
