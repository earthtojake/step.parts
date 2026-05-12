import { PartDirectory } from "@/components/part-directory";
import { buildCatalogJsonLd, stringifyJsonLd } from "@/lib/json-ld";
import { queryParts } from "@/lib/part-query";
import { getParts } from "@/lib/parts";

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: HomeProps) {
  const initialResult = await queryParts(await searchParams);
  const catalogJsonLd = buildCatalogJsonLd(getParts());

  return (
    <main className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: stringifyJsonLd(catalogJsonLd) }}
      />
      <PartDirectory initialResult={initialResult} />
    </main>
  );
}
