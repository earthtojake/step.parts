import { Search } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_PART_PAGE_SIZE } from "@/lib/part-query-constants";

const cards = Array.from({ length: DEFAULT_PART_PAGE_SIZE });

function HeaderSkeleton() {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-border pb-6">
      <div className="min-w-0">
        <p className="text-xs uppercase text-muted-foreground">Open Source CAD Directory</p>
        <div className="mt-2 flex min-w-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/favicon.ico"
            alt=""
            width={64}
            height={64}
            aria-hidden="true"
            className="size-8 shrink-0 object-contain pt-0.5 sm:size-11 sm:pt-1"
          />
          <h1 className="min-w-0 text-3xl font-semibold tracking-normal text-foreground sm:text-5xl">
            step.parts
          </h1>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Skeleton className="h-10 w-10 rounded-md" />
        <Skeleton className="h-10 w-10 rounded-md" />
      </div>
    </header>
  );
}

function SearchSkeleton() {
  return (
    <section className="flex flex-col gap-3 border-b border-border py-5" aria-label="Directory search">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative h-10 w-full rounded-md border border-border bg-background/80 sm:max-w-xl">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Skeleton className="absolute left-9 right-3 top-1/2 h-3 -translate-y-1/2 rounded-sm" />
        </div>
      </div>
    </section>
  );
}

function PartCardSkeleton({ index }: { index: number }) {
  return (
    <article
      className="relative aspect-square overflow-hidden rounded-md border border-border bg-background/78"
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-muted/25" />
      <div className="absolute inset-4 grid place-items-center sm:inset-6">
        <Skeleton
          className="aspect-square w-[76%] rounded-full"
          style={{ opacity: index % 3 === 0 ? 0.72 : index % 3 === 1 ? 0.58 : 0.66 }}
        />
      </div>
      <div className="absolute left-3 top-3 z-10">
        <Skeleton className="size-7 rounded-md" />
      </div>
      <div className="absolute right-3 top-3 z-10">
        <Skeleton className="size-7 rounded-md" />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-background/80 to-transparent" />
      <div className="absolute inset-x-3 bottom-3 space-y-2 sm:inset-x-4 sm:bottom-4">
        <Skeleton className="h-2.5 w-24 rounded-sm" />
        <Skeleton className="h-4 w-5/6 rounded-sm" />
        <Skeleton className="h-4 w-2/3 rounded-sm" />
      </div>
    </article>
  );
}

function ResultsSkeleton() {
  return (
    <section className="min-w-0" aria-label="Loading part results">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:[grid-template-columns:repeat(auto-fill,minmax(min(100%,14rem),1fr))]">
        {cards.map((_, index) => (
          <PartCardSkeleton key={index} index={index} />
        ))}
      </div>
      <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-4 w-40 rounded-sm" />
        <div className="flex items-center gap-2">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="size-8 rounded-md" />
        </div>
      </div>
    </section>
  );
}

export default function Loading() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div
        className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-6 pt-8 sm:px-6 sm:pt-10 lg:px-8"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <HeaderSkeleton />
        <SearchSkeleton />
        <div className="flex flex-1 flex-col py-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-8 w-28 rounded-md" />
              <Skeleton className="h-3 w-20 rounded-sm" />
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:justify-end">
              <Skeleton className="h-8 w-16 rounded-md" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          </div>
          <div className="flex-1">
            <ResultsSkeleton />
          </div>
        </div>
        <SiteFooter />
        <span className="sr-only">Loading catalog</span>
      </div>
    </main>
  );
}
