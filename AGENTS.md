# Agent Guide

This repo is a Next.js catalog for open-source CAD parts. The source of truth is STEP files plus human-authored catalog metadata; GLB previews, PNG thumbnails, and the SQLite catalog are generated artifacts. Generated previews are published to Vercel Blob rather than committed.

## Quick Commands

- Dev server: `npm run dev`
- Catalog SQLite metadata only: `node scripts/generate-catalog.mjs`
- Catalog build: `npm run catalog:build`
- Preview asset sync: `npm run catalog:sync-assets`
- Non-mutating catalog validation: `npm run catalog:check`
- Lint: `npm run lint`
- TypeScript check: `npx tsc --noEmit`
- Full app check: `npm run check`

`npm run catalog:build` rebuilds local GLB/PNG preview artifacts only; it does not update `catalog/parts.sqlite`. Preview Blob paths are derived from each part's STEP SHA-256, so SQLite is reproducible from source catalog metadata plus STEP files. Tune paired export lanes with `STEP_PARTS_EXPORT_CONCURRENCY`; it defaults to 2. Production `npm run catalog:sync-assets` uploads only missing deterministic Blob assets and generates local GLB/PNG files only for those missing parts.

For metadata-only changes to `catalog/parts.json`, do not run `npm run catalog:build`. Run `node scripts/generate-catalog.mjs` instead to refresh `catalog/parts.sqlite` without rebuilding GLB/PNG artifacts. Only run `catalog:build` when STEP files or preview assets need to be added, refreshed, or repaired.

The thumbnail exporter starts a local render server on `127.0.0.1`; sandboxed runs may need approval/escalation.

## Repo Shape

- `catalog/parts.json`: human-authored part records only.
- `catalog/parts.sqlite`: generated catalog metadata used by the app.
- `catalog/taxonomy.json`: narrow guardrails for rigid, repeatable families only.
- `catalog/step/{id}.step`: canonical STEP assets.
- `public/glb/{id}.glb`: local generated interactive previews, ignored by Git and synced to Vercel Blob.
- `public/png/{id}.png`: local generated 512x512 thumbnails, ignored by Git and synced to Vercel Blob.
- `scripts/add-part.mjs`: single-part helper for local STEP files.
- `scripts/generate-catalog.mjs`: regenerates catalog SQLite metadata only.
- `scripts/export-assets.mjs`: converts STEP to GLB and renders PNGs.
- `scripts/check-catalog.mjs`: validates source schema, taxonomy guardrails, STEP sanity, generated SQLite rows, and optionally published Blob assets.
- `src/components/part-directory.tsx`: searchable catalog UI and card previews.
- `src/components/part-viewer.tsx`: detail-page 3D viewer with PNG fallback.
- `src/lib/part-query.ts`: server-side search/filter/sort behavior.
- `src/app/v1/*`: catalog API routes.

STEP/STP files in `catalog/step` are Git LFS assets via `.gitattributes`. GLB/PNG previews are Vercel Blob assets and should not be committed.

Local development and catalog validation serve STEP files from `catalog/step` through `/step/{id}.step`, so local downloads match the SQLite byte sizes and hashes. Production API `stepUrl` values and single-download redirects use commit-pinned GitHub LFS media URLs by default; set `STEP_PARTS_GITHUB_REF`, `STEP_PARTS_GITHUB_REPOSITORY`, or `STEP_PARTS_GITHUB_OWNER` plus `STEP_PARTS_GITHUB_REPO` to override the GitHub target.

## Adding Parts

Prefer `npm run catalog:add` when adding a single local STEP file. It copies the STEP into `catalog/step`, appends `catalog/parts.json`, rebuilds generated assets, and validates the catalog.

For scripted use:

```bash
npm run catalog:add -- \
  --step /absolute/path/to/part.step \
  --id stable_snake_case_id \
  --name "Human part name" \
  --description "One searchable sentence." \
  --category electronics \
  --family raspberry-pi \
  --tag board \
  --tag microcontroller \
  --alias "Useful alias" \
  --attr manufacturer="Example"
```

Use `--dry-run` first when metadata is uncertain.

For large target lists, use a file instead of a long shell argument:

```bash
find catalog/step -name '*.step' > /tmp/changed-steps.txt
npm run catalog:build -- --targets-file /tmp/changed-steps.txt
npm run catalog:build -- --targets @/tmp/changed-steps.txt
```

Target list files accept one part id or asset path per line. Blank lines and lines beginning with `#` are ignored. Entries can be part ids, bare filenames, absolute or relative paths, or `catalog/step/{id}.step` paths.

For large catalog additions, use `catalog/taxonomy.json` as a lightweight context file, not as a complete ontology. It is only for rigid families with predictable identity fields and required attributes, such as standardized screws, washers, bearings, stock profiles, and helper geometry. Use it to choose existing rigid families and to detect likely duplicates. For flexible brand, product, electronics, actuator, or one-off families, inspect nearby examples in `catalog/parts.json` or query `catalog/parts.sqlite`; do not add taxonomy entries just to make every family listed.

### Metadata Rules

Keep source records limited to these keys:

- `id`: stable snake_case ASCII id matching asset filenames.
- `name`: human-facing display name.
- `description`: concise searchable sentence.
- `category`: kebab-case broad group, such as `fastener`, `stock`, or `electronics`.
- `family`: optional but strongly encouraged kebab-case product/part family used for faceting and related-part grouping when a natural grouping exists.
- `tags`: non-empty supplemental lowercase kebab-case discovery labels for reusable type, function, material, interface, or feature concepts.
- `aliases`: useful alternative names.
- `standard`: optional `{ body, number, designation }`.
- `stepSource`: optional direct live STEP/STP file URL for branded products.
- `productPage`: optional sales, product, documentation, or support page for a branded product.
- `attributes`: scalar facts only: string, number, boolean, or null.

Do not add generated fields to `catalog/parts.json`: no `stepUrl`, `glbUrl`, `pngUrl`, `byteSize`, or `sha256`.

Attribute keys must be camelCase ASCII. Prefer factual attributes that help search and filtering: `manufacturer`, `model`, `thread`, `lengthMm`, `boardLengthMm`, `boardWidthMm`, `headers`, `wireless`, etc. Do not keep source provenance in `attributes`; no `stepSource`, `productPage`, `cadAsset`, `downloadFile`, `verificationLevel`, or other source/CAD provenance keys.

Reserve `stepSource` and `productPage` for branded products with official source or product pages.

`family` should be filled in whenever there is a clear grouping a catalog user would naturally filter by within a category. Leave it out when any value would be forced or misleading. For standardized commodity parts, use the part standard or shape family: `socket-head-cap-screw`, `set-screw`, `deep-groove-ball-bearing`, `t-slot-extrusion`. For actuators and electronics, use the actual product/platform family or brand: `damiao`, `feetech`, `robstride`, `cubemars`, `raspberry-pi`, `arduino`, `adafruit`, or `sparkfun`.

When a part belongs to a family listed in `catalog/taxonomy.json`, follow that rule's category, required tags, required attributes, and identity fields. If the family is not listed there, keep the metadata consistent with nearby examples rather than expanding the taxonomy by default.

Tags are supplemental, not a duplicate metadata bucket. Use tags for reusable type, function, material, interface, or feature labels such as `screw`, `socket-head`, `metric`, `servo`, `motor`, `gear-reducer`, `board`, `camera-module`, `t-slot`, `steel`, `aluminum`, `can`, `headers`, or `wireless`. Do not tag category, family, standard, source/provenance, manufacturer-only, dimension/thread size, exact model/SKU, or one-off alias values; put those in the dedicated fields or attributes. See `TAGGING.md` before adding or reviewing tags.

### Colors And Visual Fidelity

Do not invent colors. Preserve STEP colors when the file actually contains them. If a STEP has no color styling, or the importer exposes only default white, neutral previews are expected.

Examples from existing board models:

- Files with no color styling remain neutral.
- Files the importer exposes only as default white remain neutral.
- Files with meaningful board colors keep those colors.

If a STEP file imports successfully but produces no renderable triangles in `occt-import-js`, remove that STEP file and source record before running the build again. Do not generate or commit fallback preview geometry.

### After Adding Parts

Review all of these:

- New records in `catalog/parts.json`.
- New canonical STEP files in `catalog/step/`.
- Regenerated `catalog/parts.sqlite`.

Run:

```bash
npm run catalog:check
npm run lint
npx tsc --noEmit
```

Run `npm run check` before handing off broad UI/catalog changes.

## Updating UI Or Catalog Infra

Follow existing patterns first. This app uses Next.js App Router, React 19, TypeScript, Tailwind CSS, shadcn-style UI primitives, lucide icons, Three.js, Playwright, Sharp, and `occt-import-js`.

When changing catalog schema or generated fields:

1. Update `scripts/catalog-utils.mjs`.
2. Update `scripts/check-catalog.mjs` so stale or malformed output is caught.
3. Update TypeScript types in `src/types/part.ts` and query/API types if needed.
4. Update API/schema surfaces under `src/app/v1/catalog/*`, `src/app/v1/openapi.json/route.ts`, and `src/lib/openapi.ts` as appropriate.
5. Regenerate and validate catalog outputs.

When changing search/filter behavior, update both `src/lib/part-query.ts` and any surfaced API docs/schema/OpenAPI metadata that describe query parameters or sort values.

When changing previews:

- Keep PNGs visible as fallback/initial previews.
- Keep GLB rendering interactive where it already is.
- Preserve source colors only; do not recolor models for aesthetics.
- Verify both directory cards and detail pages.

For frontend work, avoid landing-page-style redesigns. This is a utilitarian catalog: dense, searchable, and scan-friendly. Cards should be compact; controls should be predictable; text must not overlap at desktop or mobile sizes.

## Verification Notes

`npm run catalog:check` is the fastest high-signal check for part additions because it verifies source schema, taxonomy guardrails for rigid families, SQLite freshness, and STEP sanity without requiring local preview files or Blob credentials.

GitHub Actions and Vercel deployments intentionally do not download Git LFS objects for now. CI runs the lighter `npm run check:ci` app gate, so full STEP-content validation and preview generation must be run manually/local before trusting catalog changes.

For metadata-only changes, prefer `node scripts/generate-catalog.mjs` plus `npm run lint` and `npx tsc --noEmit`.

`npm run catalog:build` can be slow for large changed STEP files. GLB and PNG generation is paired per part, and paired export concurrency is configurable:

```bash
STEP_PARTS_EXPORT_CONCURRENCY=2 npm run catalog:build
```

If browser verification is needed and Playwright cannot launch in the sandbox, use an approved local browser path or ask for the appropriate escalation. Do not leave long-running dev servers or browser processes dangling.
