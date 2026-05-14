import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { PartViewer } from "@/components/part-viewer";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeaderActions } from "@/components/site-header";
import { StepDownloadLink } from "@/components/step-download-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { partPagePath } from "@/lib/agent-parts";
import { buildPartJsonLd, stringifyJsonLd } from "@/lib/json-ld";
import { stepFileName } from "@/lib/part-files";
import { getPart } from "@/lib/parts";
import { absoluteUrl, siteConfig } from "@/lib/site";
import type { Part } from "@/types/part";

export const dynamic = "force-dynamic";

type PartPageProps = {
  params: Promise<{
    id: string;
  }>;
};

type InspectorRow = {
  label: string;
  value: ReactNode;
};

function formatMetadataLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bMm\b/g, "mm")
    .replace(/\bId\b/g, "ID");
}

function formatMetadataValue(value: Part["attributes"][string]) {
  if (value === null) {
    return "null";
  }

  return String(value);
}

function buildPartRows(part: Part): InspectorRow[] {
  const rows: InspectorRow[] = [
    { label: "Category", value: part.category },
  ];

  if (part.family) {
    rows.push({ label: "Family", value: part.family });
  }

  if (part.productPage) {
    rows.push({
      label: "Product Page",
      value: <ExternalMetadataLink href={part.productPage} />,
    });
  }

  if (part.stepSource) {
    rows.push({
      label: "Step Source",
      value: <ExternalMetadataLink href={part.stepSource} />,
    });
  }

  if (part.standard) {
    rows.push(
      { label: "Standard", value: part.standard.designation },
      { label: "Standard Body", value: part.standard.body },
      { label: "Standard Number", value: part.standard.number },
    );
  }

  for (const [key, value] of Object.entries(part.attributes)) {
    rows.push({
      label: formatMetadataLabel(key),
      value: formatMetadataValue(value),
    });
  }

  return rows;
}

function humanizeToken(value: string) {
  return value.replace(/[_-]+/g, " ");
}

function buildPartMetadataTitle(part: Part) {
  return `${part.name} STEP file`;
}

function buildPartMetadataKeywords(part: Part) {
  const keywords = [
    part.name,
    part.id,
    part.category,
    humanizeToken(part.category),
    part.family,
    part.family ? humanizeToken(part.family) : undefined,
    part.standard?.designation,
    part.standard?.body,
    ...part.tags,
    ...part.aliases,
    `${part.name} STEP file`,
    `${part.name} CAD model`,
    part.family ? `${humanizeToken(part.family)} STEP file` : undefined,
    "open source STEP file",
    "CAD project part",
  ];

  return Array.from(
    new Set(
      keywords
        .filter((keyword): keyword is string => Boolean(keyword))
        .map((keyword) => keyword.trim())
        .filter(Boolean),
    ),
  );
}

function ExternalMetadataLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={href}
      className="block max-w-full truncate text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {href}
    </a>
  );
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-background/80">
      <div className="border-b border-border px-4 py-3 text-xs uppercase text-muted-foreground">
        {title}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function InspectorRows({ rows }: { rows: InspectorRow[] }) {
  return (
    <dl className="-my-3 divide-y divide-border">
      {rows.map((row, index) => (
        <div
          key={`${row.label}-${index}`}
          className="grid min-w-0 gap-1 py-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4"
        >
          <dt className="text-sm font-medium text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 whitespace-normal break-words text-sm text-foreground">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export async function generateMetadata({ params }: PartPageProps): Promise<Metadata> {
  const { id } = await params;
  const part = getPart(id);
  if (!part) {
    return {
      title: "Part not found",
    };
  }

  const metadataTitle = buildPartMetadataTitle(part);
  const metadataDescription = part.description;
  const pagePath = partPagePath(part);
  const previewImage = absoluteUrl(part.pngUrl);
  const previewAlt = `${part.name} STEP file preview`;

  return {
    title: metadataTitle,
    description: metadataDescription,
    keywords: buildPartMetadataKeywords(part),
    alternates: {
      canonical: pagePath,
    },
    openGraph: {
      title: metadataTitle,
      description: metadataDescription,
      url: pagePath,
      siteName: siteConfig.name,
      type: "website",
      images: [
        {
          url: previewImage,
          width: 512,
          height: 512,
          alt: previewAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: metadataTitle,
      description: metadataDescription,
      images: [
        {
          url: previewImage,
          width: 512,
          height: 512,
          alt: previewAlt,
        },
      ],
    },
    assets: [part.stepUrl, part.glbUrl, part.pngUrl],
    category: part.category,
    other: {
      "part:id": part.id,
      "part:category": part.category,
      ...(part.family ? { "part:family": part.family } : {}),
      ...(part.standard ? { "part:standard": part.standard.designation } : {}),
    },
  };
}

export default async function PartPage({ params }: PartPageProps) {
  const { id } = await params;
  const part = getPart(id);

  if (!part) {
    notFound();
  }

  const partJsonLd = buildPartJsonLd(part);
  const partRows = buildPartRows(part);
  const stepName = stepFileName(part.id);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: stringifyJsonLd(partJsonLd) }}
      />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-6 pt-8 sm:px-6 sm:pt-10 lg:px-8">
        <section className="flex flex-col gap-5 border-b border-border pb-6" aria-label="Part details">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Button asChild variant="ghost" className="-ml-2 mb-4 rounded-md text-muted-foreground">
                <Link href="/">
                  <ArrowLeft className="size-4" />
                  Directory
                </Link>
              </Button>
              <p className="break-all text-xs text-muted-foreground">{stepName}</p>
              <h1 className="mt-2 max-w-4xl text-2xl font-semibold tracking-normal sm:text-4xl">
                {part.name}
              </h1>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Button asChild size="lg" className="h-11 rounded-md px-5">
                  <StepDownloadLink
                    href={`/v1/parts/${part.id}/download`}
                    fileName={stepName}
                    partId={part.id}
                    partName={part.name}
                    category={part.category}
                    family={part.family}
                    standard={part.standard?.designation}
                    byteSize={part.byteSize}
                    source="part_page"
                  >
                    <Download className="size-4" />
                    Download
                  </StepDownloadLink>
                </Button>
              </div>
            </div>
            <SiteHeaderActions />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {part.tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="rounded-md border-border bg-muted/20 text-muted-foreground"
              >
                {tag}
              </Badge>
            ))}
          </div>
        </section>

        <section className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(420px,480px)]">
          <PartViewer glbUrl={part.glbUrl} pngUrl={part.pngUrl} name={part.name} />
          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
            <InspectorSection title="Summary">
              <p className="text-sm leading-6 text-muted-foreground">{part.description}</p>
            </InspectorSection>

            <InspectorSection title="Part">
              <InspectorRows rows={partRows} />
            </InspectorSection>
          </aside>
        </section>
        <Separator />
        <SiteFooter />
      </div>
    </main>
  );
}
