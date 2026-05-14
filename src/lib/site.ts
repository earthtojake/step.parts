const PRODUCTION_SITE_ORIGIN = "https://www.step.parts";
const PRODUCTION_API_ORIGIN = "https://api.step.parts";
const LOCAL_ORIGIN = "http://localhost:3000";

function defaultOrigin(productionOrigin: string) {
  return process.env.NODE_ENV === "development" ? LOCAL_ORIGIN : productionOrigin;
}

function normalizeOrigin(value: string | undefined, fallback: string) {
  const candidate = value?.trim() || fallback;

  try {
    return new URL(candidate).origin;
  } catch {
    return fallback;
  }
}

export const siteConfig = {
  name: "step.parts",
  title: "step.parts | 12,000+ open source STEP parts for your next CAD project",
  description: "12,000+ open source STEP parts for your next CAD project",
  keywords: [
    "STEP files",
    "CAD parts",
    "open source CAD",
    "mechanical parts",
    "3D CAD models",
    "fasteners",
    "bearings",
    "nuts",
    "bolts",
    "washers",
    "GLB previews",
  ],
  origin: normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL, defaultOrigin(PRODUCTION_SITE_ORIGIN)),
};

export const apiConfig = {
  origin: normalizeOrigin(process.env.NEXT_PUBLIC_API_URL, defaultOrigin(PRODUCTION_API_ORIGIN)),
};

export function absoluteUrl(path: string) {
  return new URL(path, `${siteConfig.origin}/`).toString();
}

export function apiUrl(path: string) {
  return new URL(path, `${apiConfig.origin}/`).toString();
}
