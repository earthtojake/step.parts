"use client";

import Link from "next/link";
import { type ComponentType, type FocusEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { track } from "@vercel/analytics";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Filter,
  Search,
  X,
} from "lucide-react";
import type { AgentPart } from "@/lib/agent-parts";
import type { PartFacet, PartQueryFilters, PartQueryResult } from "@/types/part-query";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StepDownloadLink } from "@/components/step-download-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { stepFileName } from "@/lib/part-files";
import { DEFAULT_PART_PAGE, DEFAULT_PART_PAGE_SIZE } from "@/lib/part-query-constants";
import { cn } from "@/lib/utils";

type PartDirectoryProps = {
  initialResult: PartQueryResult;
};

type FacetKey = "tags" | "categories" | "families" | "standards";

const QUERY_KEYS: Record<FacetKey, string> = {
  tags: "tag",
  categories: "category",
  families: "family",
  standards: "standard",
};
const DIRECTORY_QUERY_KEYS = ["q", ...Object.values(QUERY_KEYS), "page", "pageSize"];

const FACET_LABELS: Record<FacetKey, string> = {
  tags: "Tags",
  categories: "Category",
  families: "Family",
  standards: "Standard",
};

const FACET_ORDER: FacetKey[] = ["categories", "families", "standards", "tags"];
const DEFAULT_VISIBLE_FACETS = 10;
const SEARCH_DEBOUNCE_MS = 200;
const MAX_SELECTED_DOWNLOAD_PARTS = 50;
const GRID_COLUMN_OPTIONS = [1, 2, 3, 4, 5] as const;
const PAGE_SIZE_OPTIONS = [60, 120, 180].filter((pageSize) =>
  GRID_COLUMN_OPTIONS.every((columns) => pageSize % columns === 0),
);

type OrbitPreviewComponent = ComponentType<{
  glbUrl: string;
  name: string;
  active?: boolean;
  className?: string;
  onReady?: () => void;
}>;

let orbitPreviewImport: Promise<OrbitPreviewComponent> | null = null;

function loadOrbitPreview() {
  orbitPreviewImport ??= import("@/components/part-card-orbit-preview").then((mod) => mod.PartCardOrbitPreview);
  return orbitPreviewImport;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function toggleValue(values: string[], value: string) {
  const normalizedValue = normalize(value);
  return values.some((entry) => normalize(entry) === normalizedValue)
    ? values.filter((entry) => normalize(entry) !== normalizedValue)
    : [...values, value];
}

function isActive(values: string[], value: string) {
  const normalizedValue = normalize(value);
  return values.some((entry) => normalize(entry) === normalizedValue);
}

function formatPartCount(count: number) {
  return new Intl.NumberFormat("en-US").format(count);
}

function hasSelectedFacetFilters(filters: PartQueryFilters) {
  return (Object.keys(QUERY_KEYS) as FacetKey[]).some((key) => filters[key].length > 0);
}

function emptyFilters(): PartQueryFilters {
  return {
    q: "",
    tags: [],
    categories: [],
    families: [],
    standards: [],
  };
}

function hasSerializedDirectoryState(filters: PartQueryFilters, page: number, pageSize: number) {
  return (
    Boolean(filters.q.trim()) ||
    hasSelectedFacetFilters(filters) ||
    page > 1 ||
    pageSize !== DEFAULT_PART_PAGE_SIZE
  );
}

function buildQueryString(filters: PartQueryFilters, page: number, pageSize: number) {
  const params = new URLSearchParams();

  if (filters.q.trim()) {
    params.set("q", filters.q.trim());
  }

  for (const key of Object.keys(QUERY_KEYS) as FacetKey[]) {
    for (const value of filters[key]) {
      params.append(QUERY_KEYS[key], value);
    }
  }

  if (hasSerializedDirectoryState(filters, page, pageSize)) {
    params.set("page", String(page));
  }

  if (pageSize !== DEFAULT_PART_PAGE_SIZE) {
    params.set("pageSize", String(pageSize));
  }

  return params.toString();
}

function replaceDirectoryUrl(pathname: string, queryString: string) {
  const params = new URLSearchParams(window.location.search);
  for (const key of DIRECTORY_QUERY_KEYS) {
    params.delete(key);
  }

  const directoryParams = new URLSearchParams(queryString);
  for (const [key, value] of directoryParams) {
    params.append(key, value);
  }

  const nextQueryString = params.toString();
  const hash = window.location.hash;
  const nextUrl = `${pathname}${nextQueryString ? `?${nextQueryString}` : ""}${hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${hash}`;

  if (nextUrl !== currentUrl) {
    window.history.replaceState(null, "", nextUrl);
  }
}

function SelectedFilter({
  label,
  value,
  onRemove,
}: {
  label: string;
  value: string;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex h-6 items-center gap-1.5 rounded-md border border-primary/70 bg-primary text-[11px] leading-none text-primary-foreground transition hover:bg-primary/90"
      aria-label={`Remove ${label} filter ${value}`}
    >
      <span className="px-2 pr-0">{value}</span>
      <span className="grid h-6 w-5 place-items-center border-l border-primary-foreground/20">
        <X className="size-3" />
      </span>
    </button>
  );
}

function FacetOption({
  facet,
  checked,
  onChange,
}: {
  facet: PartFacet;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-5 cursor-pointer items-center gap-1.5 rounded-sm px-1 py-0.5 text-[11px] leading-4 transition hover:bg-accent/20",
        checked ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-3 shrink-0 rounded border-border accent-primary"
      />
      <span className="min-w-0 flex-1 truncate">{facet.value}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground">{facet.count}</span>
    </label>
  );
}

function FacetGroup({
  title,
  facets,
  selected,
  onToggle,
}: {
  title: string;
  facets: PartFacet[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const compactFacets = facets.slice(0, DEFAULT_VISIBLE_FACETS);
  const visibleFacets = showAll ? facets : compactFacets;
  const hiddenCount = facets.length - compactFacets.length;

  return (
    <section className="border-t border-border py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[11px] uppercase leading-none text-muted-foreground">{title}</h3>
        <span className="text-[10px] uppercase leading-none text-muted-foreground">
          {selected.length > 0 ? `${selected.length} selected` : `${facets.length} options`}
        </span>
      </div>
      {facets.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {visibleFacets.map((facet) => (
            <FacetOption
              key={facet.value}
              facet={facet}
              checked={isActive(selected, facet.value)}
              onChange={() => onToggle(facet.value)}
            />
          ))}
          {hiddenCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              className="mt-1 h-6 justify-start rounded-md px-1 text-[11px] text-muted-foreground"
              onClick={() => setShowAll((current) => !current)}
            >
              <ChevronDown className={cn("size-3 transition", showAll ? "rotate-180" : "")} />
              {showAll ? "Less" : `More (${hiddenCount})`}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 text-[11px] leading-4 text-muted-foreground">No matching values.</div>
      )}
    </section>
  );
}

function FilterPanel({
  facets,
  filters,
  onToggle,
  className,
}: {
  facets: PartQueryResult["facets"];
  filters: PartQueryFilters;
  onToggle: (key: FacetKey, value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {FACET_ORDER.map((key) => (
        <FacetGroup
          key={key}
          title={FACET_LABELS[key]}
          facets={facets[key]}
          selected={filters[key]}
          onToggle={(value) => onToggle(key, value)}
        />
      ))}
    </div>
  );
}

function PartCard({
  part,
  selected,
  selectionDisabled,
  onSelectionChange,
}: {
  part: AgentPart;
  selected: boolean;
  selectionDisabled: boolean;
  onSelectionChange: (partId: string, selected: boolean) => void;
}) {
  const stepUrl = `/v1/parts/${part.id}/download`;
  const stepName = stepFileName(part.id);
  const pngUrl = part.pngUrl;
  const glbUrl = part.glbUrl;
  const [showOrbitPreview, setShowOrbitPreview] = useState(false);
  const [orbitPreviewReady, setOrbitPreviewReady] = useState(false);
  const [OrbitPreview, setOrbitPreview] = useState<OrbitPreviewComponent | null>(null);

  useEffect(() => {
    if (!showOrbitPreview || OrbitPreview) {
      return;
    }

    let cancelled = false;
    loadOrbitPreview().then((component) => {
      if (!cancelled) {
        setOrbitPreview(() => component);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [OrbitPreview, showOrbitPreview]);

  const showPreview = () => {
    if (!showOrbitPreview) {
      setOrbitPreviewReady(false);
    }
    setShowOrbitPreview(true);
  };

  const hidePreview = () => {
    setOrbitPreviewReady(false);
    setShowOrbitPreview(false);
  };

  const handleOrbitPreviewReady = useCallback(() => {
    setOrbitPreviewReady(true);
  }, []);

  const hidePreviewOnBlur = (event: FocusEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    hidePreview();
  };

  return (
    <article
      onPointerEnter={showPreview}
      onPointerLeave={hidePreview}
      onFocus={showPreview}
      onBlur={hidePreviewOnBlur}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-md border bg-card transition duration-200 hover:-translate-y-0.5",
        selected
          ? "border-primary/70 ring-1 ring-primary/40"
          : "border-border hover:border-foreground/30",
      )}
    >
      <div className="part-preview-surface pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-4 sm:inset-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pngUrl}
            alt=""
            width={512}
            height={512}
            loading="lazy"
            decoding="async"
            className={cn(
              "h-full w-full object-contain",
              showOrbitPreview && orbitPreviewReady ? "opacity-0" : "opacity-100",
            )}
          />
          {showOrbitPreview && OrbitPreview ? (
            <OrbitPreview
              glbUrl={glbUrl}
              name={part.name}
              active={orbitPreviewReady}
              onReady={handleOrbitPreviewReady}
              className={cn(
                "pointer-events-none absolute inset-0",
                orbitPreviewReady ? "opacity-100" : "opacity-0",
              )}
            />
          ) : null}
        </div>
      </div>
      <Link
        href={`/parts/${part.id}`}
        className="absolute inset-0 z-10 flex flex-col justify-end focus:outline-none"
        aria-label={`Open ${part.name}`}
      >
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-background/92 via-background/70 to-transparent dark:from-background/86 dark:via-background/62" />
        <div className="relative p-3 sm:p-4">
          <div className="min-w-0">
            <p className="truncate text-[10px] text-muted-foreground">{stepName}</p>
            <h2 className="mt-1.5 line-clamp-2 text-xs font-semibold leading-4 text-foreground sm:mt-2 sm:text-sm sm:leading-5">
              {part.name}
            </h2>
          </div>
        </div>
      </Link>
      <label className="absolute left-0 top-0 z-20 size-[52px] cursor-pointer">
        <input
          type="checkbox"
          checked={selected}
          disabled={selectionDisabled}
          onChange={(event) => onSelectionChange(part.id, event.currentTarget.checked)}
          className="peer absolute left-3 top-3 z-10 size-7 cursor-pointer appearance-none rounded-md border border-border/80 bg-background/85 shadow-sm backdrop-blur-sm transition checked:border-primary checked:bg-primary disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={`Select ${part.name} for download`}
        />
        <Check className="pointer-events-none absolute left-[18px] top-[18px] z-20 size-4 text-primary-foreground opacity-0 transition peer-checked:opacity-100" />
      </label>
      <Button
        asChild
        variant="outline"
        size="icon-sm"
        className="absolute right-3 top-3 z-20 size-7 rounded-md border-border/80 bg-background/85 p-0 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-background hover:text-foreground"
      >
        <StepDownloadLink
          href={stepUrl}
          fileName={stepName}
          partId={part.id}
          partName={part.name}
          category={part.category}
          family={part.family}
          standard={part.standard?.designation}
          byteSize={part.byteSize}
          source="directory_card"
          aria-label={`Download STEP for ${part.name}`}
        >
          <Download className="size-3.5" />
        </StepDownloadLink>
      </Button>
    </article>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  hasNextPage,
  hasPreviousPage,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const hasPages = totalPages > 1;
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);
  const selectedPageSize = PAGE_SIZE_OPTIONS.includes(pageSize) ? String(pageSize) : "";

  const commitPageEntry = (input: HTMLInputElement) => {
    const parsedPage = Number.parseInt(input.value, 10);

    if (!Number.isFinite(parsedPage)) {
      input.value = String(page);
      return;
    }

    const nextPage = Math.max(1, Math.min(parsedPage, totalPages));
    input.value = String(nextPage);

    if (nextPage !== page) {
      onPageChange(nextPage);
    }
  };

  if (total === 0) {
    return null;
  }

  return (
    <div className="mt-6 flex flex-col gap-3 border-y border-border py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 text-xs text-muted-foreground">
        <span>
          Showing {firstItem}-{lastItem} of {total}
        </span>
        <label className="ml-4 flex items-center gap-2 text-xs text-muted-foreground">
          <span>Per page</span>
          <span className="relative inline-flex">
            <select
              value={selectedPageSize}
              onChange={(event) => onPageSizeChange(Number(event.currentTarget.value))}
              className="h-8 w-[4.5rem] appearance-none rounded-md border border-border bg-background pl-3 pr-8 text-xs text-foreground shadow-sm outline-none transition hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="Parts per page"
            >
              {selectedPageSize ? null : (
                <option value="" disabled>
                  {pageSize}
                </option>
              )}
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground" />
          </span>
        </label>
      </div>

      {hasPages ? (
        <nav className="flex flex-wrap items-center justify-start gap-2 sm:justify-end" aria-label="Pagination">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="size-8 rounded-md"
            disabled={!hasPreviousPage}
            onClick={() => onPageChange(1)}
            aria-label="First page"
          >
            <ChevronsLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="size-8 rounded-md"
            disabled={!hasPreviousPage}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground shadow-sm">
            <span>Page</span>
            <input
              key={page}
              defaultValue={page}
              inputMode="numeric"
              pattern="[0-9]*"
              onChange={(event) => {
                event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "");
              }}
              onBlur={(event) => commitPageEntry(event.currentTarget)}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              onMouseUp={(event) => event.preventDefault()}
              aria-label="Current page"
              className="h-6 w-10 rounded-sm border border-border/70 bg-background text-center text-xs text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <span>of {totalPages}</span>
          </label>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="size-8 rounded-md"
            disabled={!hasNextPage}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="size-8 rounded-md"
            disabled={!hasNextPage}
            onClick={() => onPageChange(totalPages)}
            aria-label="Last page"
          >
            <ChevronsRight className="size-4" />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}

export function PartDirectory({ initialResult }: PartDirectoryProps) {
  const pathname = usePathname();
  const didMountRef = useRef(false);
  const [result, setResult] = useState(initialResult);
  const [filters, setFilters] = useState<PartQueryFilters>(initialResult.filters);
  const [searchInput, setSearchInput] = useState(initialResult.filters.q);
  const [page, setPage] = useState(initialResult.page);
  const [pageSize, setPageSize] = useState(initialResult.pageSize);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(() => hasSelectedFacetFilters(initialResult.filters));
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);
  const [isSelectionDownloading, setIsSelectionDownloading] = useState(false);
  const [selectedDownloadError, setSelectedDownloadError] = useState<string | null>(null);
  const selectedPartIdSet = useMemo(() => new Set(selectedPartIds), [selectedPartIds]);
  const visiblePartIds = useMemo(() => result.items.map((part) => part.id), [result.items]);
  const searchPlaceholder = useMemo(
    () => `Search ${formatPartCount(result.catalog.partCount)} parts`,
    [result.catalog.partCount],
  );
  const allVisiblePartsSelected =
    visiblePartIds.length > 0 && visiblePartIds.every((partId) => selectedPartIdSet.has(partId));
  const queryString = useMemo(() => buildQueryString(filters, page, pageSize), [filters, page, pageSize]);
  const loadedQueryStringRef = useRef(queryString);

  const commitQuery = useCallback((query: string) => {
    setFilters((currentFilters) =>
      currentFilters.q === query ? currentFilters : { ...currentFilters, q: query },
    );
    setPage(1);
  }, []);

  useEffect(() => {
    if (searchInput === filters.q) {
      return;
    }

    const timeout = window.setTimeout(() => commitQuery(searchInput), SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [commitQuery, filters.q, searchInput]);

  useEffect(() => {
    replaceDirectoryUrl(pathname, queryString);
  }, [pathname, queryString]);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    if (queryString === loadedQueryStringRef.current) {
      return;
    }

    if (searchInput !== filters.q) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const loadParts = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/v1/parts${queryString ? `?${queryString}` : ""}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }

        const nextResult = (await response.json()) as PartQueryResult;
        loadedQueryStringRef.current = buildQueryString(
          nextResult.filters,
          nextResult.page,
          nextResult.pageSize,
        );
        setResult(nextResult);
        setPageSize(nextResult.pageSize);
        if (nextResult.page !== page) {
          setPage(nextResult.page);
        }
      } catch (requestError) {
        if (!(requestError instanceof DOMException && requestError.name === "AbortError")) {
          setError("Could not load matching parts.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadParts();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filters.q, page, queryString, searchInput]);

  const updateQuery = (query: string) => {
    setSearchInput(query);
  };

  const clearQuery = () => {
    setSearchInput("");
    commitQuery("");
  };

  const toggleFacet = (key: FacetKey, value: string) => {
    setFilters((currentFilters) => ({
      ...currentFilters,
      [key]: toggleValue(currentFilters[key], value),
    }));
    setPage(1);
  };

  const updatePageSize = (nextPageSize: number) => {
    setPageSize(nextPageSize);
    setPage(1);
  };

  const clearAllFilters = () => {
    setSearchInput("");
    setFilters(emptyFilters());
    setPage(DEFAULT_PART_PAGE);
  };

  const resetDirectoryState = useCallback(() => {
    setSearchInput("");
    setFilters(emptyFilters());
    setPage(DEFAULT_PART_PAGE);
    setPageSize(DEFAULT_PART_PAGE_SIZE);
  }, []);

  const togglePartSelection = useCallback((partId: string, isSelected: boolean) => {
    if (
      isSelected &&
      selectedPartIds.length >= MAX_SELECTED_DOWNLOAD_PARTS &&
      !selectedPartIds.includes(partId)
    ) {
      setSelectedDownloadError(`Selected downloads are limited to ${MAX_SELECTED_DOWNLOAD_PARTS} parts.`);
      return;
    }

    setSelectedPartIds((currentPartIds) => {
      if (isSelected) {
        return currentPartIds.includes(partId) ? currentPartIds : [...currentPartIds, partId];
      }

      return currentPartIds.filter((currentPartId) => currentPartId !== partId);
    });
    setSelectedDownloadError(null);
  }, [selectedPartIds]);

  const clearPartSelection = () => {
    setSelectedPartIds([]);
    setSelectedDownloadError(null);
  };

  const selectVisibleParts = () => {
    const remainingSlots = MAX_SELECTED_DOWNLOAD_PARTS - selectedPartIds.length;
    const unselectedVisiblePartIds = visiblePartIds.filter((partId) => !selectedPartIdSet.has(partId));
    const capped = unselectedVisiblePartIds.length > remainingSlots;

    setSelectedPartIds((currentPartIds) => {
      const nextPartIds = new Set(currentPartIds);

      for (const partId of visiblePartIds) {
        if (!nextPartIds.has(partId) && nextPartIds.size >= MAX_SELECTED_DOWNLOAD_PARTS) {
          break;
        }

        nextPartIds.add(partId);
      }

      return Array.from(nextPartIds);
    });

    setSelectedDownloadError(capped ? `Selected downloads are limited to ${MAX_SELECTED_DOWNLOAD_PARTS} parts.` : null);
  };

  const downloadSelectedParts = () => {
    if (selectedPartIds.length === 0 || isSelectionDownloading) {
      return;
    }

    if (selectedPartIds.length > MAX_SELECTED_DOWNLOAD_PARTS) {
      setSelectedDownloadError(`Selected downloads are limited to ${MAX_SELECTED_DOWNLOAD_PARTS} parts.`);
      return;
    }

    setIsSelectionDownloading(true);
    setSelectedDownloadError(null);

    try {
      for (const partId of selectedPartIds) {
        const link = document.createElement("a");
        link.href = `/v1/parts/${encodeURIComponent(partId)}/download`;
        link.download = stepFileName(partId);
        link.style.display = "none";
        document.body.append(link);
        link.click();
        link.remove();
      }

      track("Selected Step Files Download", {
        part_count: selectedPartIds.length,
        source: "directory",
      });
    } catch {
      setSelectedDownloadError("Could not download selected parts.");
    } finally {
      setIsSelectionDownloading(false);
    }
  };

  const selectedFacetEntries = (Object.keys(QUERY_KEYS) as FacetKey[]).flatMap((key) =>
    filters[key].map((value) => ({ key, value })),
  );
  const hasActiveFilters = Boolean(searchInput.trim()) || selectedFacetEntries.length > 0;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-6 pt-8 sm:px-6 sm:pt-10 lg:px-8">
      <SiteHeader onBrandClick={resetDirectoryState} />
      <section className="flex flex-col gap-3 border-b border-border py-5" aria-label="Directory search">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-10 rounded-md border-border bg-background/80 pl-9 pr-9 text-sm"
            />
            {searchInput ? (
              <button
                type="button"
                onClick={clearQuery}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        </div>

        {selectedFacetEntries.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {selectedFacetEntries.map(({ key, value }) => (
              <SelectedFilter
                key={`${key}-${value}`}
                label={FACET_LABELS[key]}
                value={value}
                onRemove={() => toggleFacet(key, value)}
              />
            ))}
          </div>
        ) : null}
      </section>

      <main className="flex flex-1 flex-col py-5" aria-busy={isLoading}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant={filtersOpen ? "secondary" : "outline"}
              className="h-8 rounded-md border-foreground/30 bg-background/90 px-2 text-xs font-semibold shadow-sm"
              aria-controls="directory-filter-panel"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((isOpen) => !isOpen)}
            >
              <Filter className="size-3.5" />
              {filtersOpen ? "Hide filters" : "Show filters"}
              {selectedFacetEntries.length > 0 ? (
                <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-md bg-primary px-1 text-[10px] leading-none text-primary-foreground">
                  {selectedFacetEntries.length}
                </span>
              ) : null}
              <ChevronDown className={cn("size-3.5 transition", filtersOpen ? "rotate-180" : "")} />
            </Button>
            {isLoading || error || selectedDownloadError ? (
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                {isLoading ? <span>Loading...</span> : null}
                {error ? <span className="text-destructive">{error}</span> : null}
                {selectedDownloadError ? <span className="text-destructive">{selectedDownloadError}</span> : null}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:justify-end">
            {selectedPartIds.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                className="h-8 rounded-md px-2 text-xs"
                onClick={clearPartSelection}
              >
                Deselect All
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              className="h-8 rounded-md px-2 text-xs"
              disabled={
                isLoading ||
                visiblePartIds.length === 0 ||
                allVisiblePartsSelected ||
                selectedPartIds.length >= MAX_SELECTED_DOWNLOAD_PARTS
              }
              onClick={selectVisibleParts}
            >
              Select All
            </Button>
            {selectedPartIds.length > 0 ? (
              <Button
                type="button"
                variant="default"
                className="h-8 rounded-md px-2 text-xs font-semibold"
                disabled={isSelectionDownloading}
                onClick={downloadSelectedParts}
              >
                {isSelectionDownloading ? "Starting..." : "Download"}
                <Download className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </div>

        <div
          className={cn(
            "grid flex-1 gap-5",
            filtersOpen ? "lg:grid-cols-[15rem_minmax(0,1fr)]" : "grid-cols-1",
          )}
        >
          {filtersOpen ? (
            <aside
              id="directory-filter-panel"
              className="border-b border-border pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4"
              aria-label="Part filters"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-foreground">Filters</h2>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 rounded-md px-2 text-xs"
                  disabled={!hasActiveFilters}
                  onClick={clearAllFilters}
                >
                  Reset
                </Button>
              </div>
              <FilterPanel
                facets={result.facets}
                filters={filters}
                onToggle={toggleFacet}
              />
            </aside>
          ) : null}

          <section className="min-w-0" aria-label="Part results">
          {result.items.length > 0 ? (
            <div
              className={cn(
                "grid grid-cols-2 gap-3 sm:gap-4 sm:[grid-template-columns:repeat(auto-fill,minmax(min(100%,14rem),1fr))]",
                isLoading ? "opacity-60" : "",
              )}
            >
              {result.items.map((part) => (
                <PartCard
                  key={part.id}
                  part={part}
                  selected={selectedPartIdSet.has(part.id)}
                  selectionDisabled={
                    !selectedPartIdSet.has(part.id) && selectedPartIds.length >= MAX_SELECTED_DOWNLOAD_PARTS
                  }
                  onSelectionChange={togglePartSelection}
                />
              ))}
            </div>
          ) : (
            <div className="grid h-56 place-items-center rounded-md border border-border bg-background/78 text-sm text-muted-foreground">
              No matching parts.
            </div>
          )}
          <Pagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            totalPages={result.totalPages}
            hasNextPage={result.hasNextPage}
            hasPreviousPage={result.hasPreviousPage}
            onPageChange={setPage}
            onPageSizeChange={updatePageSize}
          />
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
