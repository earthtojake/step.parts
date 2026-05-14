import { ArrowLeft, Download } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

const tags = Array.from({ length: 6 });
const partRows = Array.from({ length: 8 });

function HeaderActionsSkeleton() {
  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2" aria-hidden="true">
      <Skeleton className="h-10 w-16 rounded-md" />
      <Skeleton className="size-10 rounded-md" />
      <Skeleton className="size-10 rounded-md" />
    </div>
  );
}

function PartHeaderSkeleton() {
  return (
    <section className="flex flex-col gap-5 border-b border-border pb-6" aria-label="Loading part details">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="-ml-2 mb-4 flex h-8 w-28 items-center gap-2 rounded-md px-2" aria-hidden="true">
            <ArrowLeft className="size-4 text-muted-foreground/50" />
            <Skeleton className="h-3 w-16 rounded-sm" />
          </div>
          <Skeleton className="h-3 w-40 max-w-full rounded-sm sm:w-56" />
          <div className="mt-2 max-w-4xl space-y-3">
            <Skeleton className="h-8 w-full max-w-3xl rounded-sm sm:h-10" />
            <Skeleton className="h-8 w-2/3 max-w-xl rounded-sm sm:h-10" />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div className="inline-flex h-11 w-36 items-center justify-center gap-2 rounded-md bg-primary/20 px-5" aria-hidden="true">
              <Download className="size-4 text-primary/50" />
              <Skeleton className="h-3 w-20 rounded-sm bg-primary/25" />
            </div>
          </div>
        </div>
        <HeaderActionsSkeleton />
      </div>
      <div className="flex flex-wrap gap-1.5" aria-hidden="true">
        {tags.map((_, index) => (
          <Skeleton
            key={index}
            className="h-6 rounded-md border border-border bg-muted/30"
            style={{ width: `${3.75 + (index % 3) * 1.5}rem` }}
          />
        ))}
      </div>
    </section>
  );
}

function ViewerSkeleton() {
  return (
    <div
      className="part-preview-surface relative h-[62vh] min-h-[420px] overflow-hidden rounded-md border border-border lg:min-h-[560px] lg:self-start"
      aria-hidden="true"
    >
      <div className="absolute right-3 top-3 flex gap-2">
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="size-8 rounded-md" />
      </div>
      <div className="absolute inset-6 grid place-items-center">
        <Skeleton className="aspect-square w-[62%] max-w-[24rem] rounded-full opacity-70" />
      </div>
      <div className="absolute inset-x-[18%] bottom-[18%] h-8 rounded-full bg-foreground/5 blur-md" />
      <div className="absolute inset-0 bg-linear-to-b from-background/5 to-background/10" />
    </div>
  );
}

function InspectorSectionSkeleton({
  headerWidth,
  rows,
}: {
  headerWidth: string;
  rows: number;
}) {
  return (
    <section className="rounded-md border border-border bg-background/80" aria-hidden="true">
      <div className="border-b border-border px-4 py-3">
        <Skeleton className="h-3 rounded-sm" style={{ width: headerWidth }} />
      </div>
      <div className="p-4">
        <div className="-my-3 divide-y divide-border">
          {Array.from({ length: rows }).map((_, index) => (
            <div
              key={index}
              className="grid min-w-0 gap-1 py-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4"
            >
              <Skeleton className="h-4 w-24 rounded-sm" />
              <Skeleton
                className="h-4 rounded-sm"
                style={{ width: `${index % 3 === 0 ? 88 : index % 3 === 1 ? 70 : 52}%` }}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function InspectorSkeleton() {
  return (
    <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
      <section className="rounded-md border border-border bg-background/80" aria-hidden="true">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-3 w-20 rounded-sm" />
        </div>
        <div className="space-y-3 p-4">
          <Skeleton className="h-4 w-full rounded-sm" />
          <Skeleton className="h-4 w-11/12 rounded-sm" />
          <Skeleton className="h-4 w-3/4 rounded-sm" />
        </div>
      </section>
      <InspectorSectionSkeleton headerWidth="2.75rem" rows={partRows.length} />
    </aside>
  );
}

export default function Loading() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div
        className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-6 pt-8 sm:px-6 sm:pt-10 lg:px-8"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <PartHeaderSkeleton />
        <section className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(420px,480px)]">
          <ViewerSkeleton />
          <InspectorSkeleton />
        </section>
        <Separator />
        <SiteFooter />
        <span className="sr-only">Loading part details</span>
      </div>
    </main>
  );
}
