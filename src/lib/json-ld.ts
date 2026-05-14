import type { Part } from "@/types/part";
import { describePart, getUniqueTags, serializePartForAgent } from "@/lib/agent-parts";
import { absoluteUrl, siteConfig } from "@/lib/site";

export function stringifyJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildCatalogJsonLd(parts: Part[]) {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "STEP Parts catalog",
    description: siteConfig.description,
    url: absoluteUrl("/"),
    keywords: getUniqueTags(parts).join(", "),
  };
}

export function buildPartJsonLd(part: Part) {
  const serializedPart = serializePartForAgent(part);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    identifier: serializedPart.id,
    name: serializedPart.name,
    description: describePart(part),
    url: serializedPart.pageUrl,
    image: serializedPart.pngUrl,
    keywords: serializedPart.tags.join(", "),
    category: serializedPart.category,
    additionalProperty: [
      ...(serializedPart.family
        ? [
            {
              "@type": "PropertyValue",
              name: "Family",
              value: serializedPart.family,
            },
          ]
        : []),
      ...(serializedPart.standard
        ? [
            {
              "@type": "PropertyValue",
              name: "Standard",
              value: serializedPart.standard.designation,
            },
          ]
        : []),
      ...(serializedPart.productPage
        ? [
            {
              "@type": "PropertyValue",
              name: "Product Page",
              value: serializedPart.productPage,
            },
          ]
        : []),
      ...(serializedPart.stepSource
        ? [
            {
              "@type": "PropertyValue",
              name: "Step Source",
              value: serializedPart.stepSource,
            },
          ]
        : []),
      ...Object.entries(serializedPart.attributes).map(([name, value]) => ({
        "@type": "PropertyValue",
        name,
        value: value ?? "unspecified",
      })),
      {
        "@type": "PropertyValue",
        name: "STEP file URL",
        value: serializedPart.stepUrl,
      },
      {
        "@type": "PropertyValue",
        name: "GLB preview URL",
        value: serializedPart.glbUrl,
      },
      {
        "@type": "PropertyValue",
        name: "PNG thumbnail URL",
        value: serializedPart.pngUrl,
      },
      {
        "@type": "PropertyValue",
        name: "STEP byte size",
        value: serializedPart.byteSize ?? "pending",
      },
      {
        "@type": "PropertyValue",
        name: "SHA-256",
        value: serializedPart.sha256 ?? "pending",
      },
    ],
  };
}
