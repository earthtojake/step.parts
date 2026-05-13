<p align="center">
  <img alt="step.parts social preview" src="public/step-parts-social-preview.png" width="720">
</p>

<h1 align="center">🔩 step.parts 🔩</h1>

<p align="center">
  <a href="https://www.step.parts">Open</a>
</p>

<p align="center">
  <a href="https://nextjs.org/"><img alt="Next.js" src="https://img.shields.io/badge/Next.js-16.2.6-000000?logo=nextdotjs&amp;logoColor=white"></a>
  <a href="https://react.dev/"><img alt="React" src="https://img.shields.io/badge/React-19.2.4-149eca?logo=react&amp;logoColor=white"></a>
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&amp;logoColor=white"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
  <a href="#catalog-and-assets"><img alt="Catalog" src="https://img.shields.io/badge/catalog-STEP%20%2B%20Blob%20previews-2f6f73"></a>
  <a href="#preview-assets"><img alt="Assets" src="https://img.shields.io/badge/previews-Vercel%20Blob-000000"></a>
</p>

<p align="center">12,000+ open source STEP parts for your next CAD project</p>

## 🧱 Parts

step.parts is a searchable directory of open-source STEP models for parts you can drop into CAD assemblies, robot builds, electronics layouts, and mechanical prototypes. Each catalog entry pairs a canonical STEP file with human-authored metadata and generated preview assets.

You can find components such as:

- **🔩 Fasteners and hardware:** screws, nuts, washers, pins, spacers, standoffs, and threaded parts
- **📐 Stock and structural parts:** extrusion profiles, plates, brackets, helper geometry, and enclosure pieces
- **⚙️ Motion and power transmission parts:** bearings, gears, pulleys, shafts, belts, and linear-motion components
- **🔌 Electronics and thermal parts:** development boards, modules, connectors, sensors, heatsinks, and fans
- **🤖 Actuators and robotics parts:** servos, motors, robot actuators, gear reducers, and related mounting hardware

## 🧰 Contributions

Use the add-part helper to add STEP files to the catalog:

```bash
npm run catalog:add
```

The command prompts for a local STEP file path, part metadata, tags, aliases, optional standard details, and attributes. It generates the part id, copies the STEP file into the catalog, updates the source catalog, refreshes SQLite catalog metadata, exports GLB/PNG previews, and validates everything.

For scripted additions, pass the same values as flags:

```bash
npm run catalog:add -- \
  --step /path/to/iso4762_m3x12.step \
  --name "ISO 4762 socket head cap screw, M3 x 12" \
  --category fastener \
  --family socket-head-cap-screw \
  --tag screw \
  --tag socket-head \
  --tag metric \
  --alias "SHCS M3x12" \
  --standard "ISO 4762" \
  --attr thread=M3 \
  --attr lengthMm=12 \
  --attr driveStyle=hex-socket
```

Preview the generated record without writing files:

```bash
npm run catalog:add -- --dry-run --step /path/to/part.step --name "Example part" --category fastener --family socket-head-cap-screw --tag screw --attr thread=M3
```

Review and commit:

- the new source entry in `catalog/parts.json`
- the canonical STEP file in `catalog/step/`
- regenerated SQLite catalog in `catalog/parts.sqlite`
- deterministic GLB and PNG preview URLs, uploaded by production `npm run catalog:sync-assets`

## 💻 Local Development

Use Node.js 22.5 or newer. The repo includes `.nvmrc`, so `nvm use` will select the same major version used by CI.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 📘 Catalog And Assets

The human-authored catalog is `catalog/parts.json`. It contains only semantic fields:

- `id`: stable snake_case ASCII identifier
- `name` and `description`: searchable human-readable text
- `category`: kebab-case broad group such as `fastener`, `actuator`, or `electronics`
- `family`: optional but strongly encouraged kebab-case product/part family used for faceting and related grouping when a natural grouping exists. Examples: `socket-head-cap-screw`, `deep-groove-ball-bearing`, `t-slot-extrusion`, `damiao`, `feetech`, `raspberry-pi`, or `arduino`.
- `tags`: supplemental lowercase kebab-case discovery labels for reusable type, function, material, interface, or feature concepts. Do not duplicate category, family, standard, aliases, model/SKU values, dimensions, manufacturer names, or provenance.
- `aliases`: alternate lookup terms, abbreviations, and compact names
- `standard`: optional `{ body, number, designation }`
- `stepSource`: optional direct live STEP/STP file URL for branded products
- `productPage`: optional sales, product, documentation, or support page for a branded product
- `attributes`: part-specific scalar facts such as `thread`, `lengthMm`, `material`, or `slotSizeMm`

Reserve `stepSource` and `productPage` for branded products with official source or product pages.

See [`TAGGING.md`](TAGGING.md) before adding or reviewing tags. Catalog files live together under `catalog/`:

- `catalog/parts.json`: human-authored source catalog
- `catalog/parts.sqlite`: generated catalog metadata consumed by the app
- `catalog/taxonomy.json`: guardrails for rigid, repeatable families such as standardized fasteners, washers, bearings, stock, and helper geometry
- `catalog/step/{id}.step`
- local generated previews under `public/glb/` and `public/png/` are ignored by Git and published to Vercel Blob

`catalog/taxonomy.json` is intentionally narrow. Use it when a family has predictable identity fields and required attributes, such as `thread` plus `lengthMm` for screws or profile dimensions for stock. Do not add flexible brand, product, or one-off families just to make the taxonomy exhaustive; use existing examples in `catalog/parts.json` and the SQLite search API for those.

Generated catalog rows add stable asset URLs, STEP byte size, and STEP SHA-256 checksum. Refresh SQLite without rebuilding preview assets:

```bash
node scripts/generate-catalog.mjs
```

When local preview assets need to be inspected or repaired, run the catalog asset build. Each selected STEP part is processed as a GLB/PNG pair, and SQLite is not modified.

Use `STEP_PARTS_EXPORT_CONCURRENCY` to tune paired export lanes; it defaults to `2`. Use `--targets` to build specific outputs:

```bash
npm run catalog:build -- --force-build
npm run catalog:build -- --targets public/glb/raspberry_pi_5.glb,public/png/raspberry_pi_5.png
```

For large batches, put targets in a newline-delimited file. Blank lines and lines beginning with `#` are ignored. Entries can be part ids, bare filenames, absolute or relative paths, or `catalog/step/{id}.step` paths:

```bash
find catalog/step -name '*.step' > /tmp/changed-steps.txt
npm run catalog:build -- --targets-file /tmp/changed-steps.txt
npm run catalog:build -- --targets @/tmp/changed-steps.txt
```

Full metadata rewrites belong to `node scripts/generate-catalog.mjs`.

Verify that committed generated files and assets are current without rewriting anything:

```bash
npm run catalog:check
```

## Preview Assets

The app serves GLB and PNG preview URLs directly from Vercel Blob. Local catalog builds still write generated previews to `public/glb/` and `public/png/`, but those directories are ignored and should not be committed.

After rebuilding previews, publish them to Blob:

```bash
BLOB_READ_WRITE_TOKEN=... npm run catalog:sync-assets
```

The sync command uploads immutable public assets at `preview/glb/{id}-{stepSha256}.glb` and `preview/png/{id}-{stepSha256}.png`. Set `STEP_PARTS_BLOB_BASE_URL` in production to the printed `https://...public.blob.vercel-storage.com` origin so API records can return direct Blob URLs.

## 🧪 API

The public API lives under `https://api.step.parts/v1`. The app also uses the same `/v1` routes locally for server-side search, filtering, counted downloads, and pagination. All `/v1` responses include permissive CORS headers for external tools and agents.

`GET /v1/parts` returns `catalog` freshness metadata, `items`, pagination metadata, active filters, and facet counts. Results are ordered by deduplicated internal download popularity, then stable source catalog order; download counts are not exposed in API responses. Facet counts are global unless a category is selected; then `tag`, `family`, and `standard` facets are scoped to the selected categories while category options stay global. Query parameters:

- `q`: metadata search across names, tags, aliases, standards, product/source URLs, and attributes
- `tag`: repeated supplemental tag filter for reusable type, function, material, interface, or feature labels
- `category`, `family`, `standard`: repeated filters for dedicated metadata fields
- `page`: 1-based page number
- `pageSize`: defaults to 60 and is capped at 200

Examples:

- `https://api.step.parts/v1/parts?q=M3&tag=screw&page=2`
- `https://api.step.parts/v1/parts?pageSize=100`
- `https://api.step.parts/v1/parts?category=fastener&family=socket-head-cap-screw&standard=ISO%204762`
- `https://api.step.parts/v1/parts?q=lengthMm%2012`

Additional machine-readable surfaces:

- `https://api.step.parts/v1/openapi.json`: OpenAPI 3.1 contract for the query API, single-part lookup, counted downloads, compact index, and schema endpoint
- `https://api.step.parts/v1/catalog/schema`: JSON Schema plus field definitions, filter semantics, result ordering, and per-family attribute definitions
- `https://api.step.parts/v1/catalog/parts.index.json`: compact id/name/facet discovery index for cheap agent lookups before fetching details
- `https://api.step.parts/v1/parts/{id}`: single-part lookup with absolute `pageUrl`, `apiUrl`, `downloadUrl`, `glbUrl`, `pngUrl`, and environment-aware `stepUrl`
- `https://api.step.parts/v1/parts/{id}/download`: counted single STEP download; local/dev serves `catalog/step` bytes and production redirects to the commit-pinned GitHub LFS media URL

Common agent lookups:

- Resolve aliases: `https://api.step.parts/v1/parts?q=SHCS`
- Search attribute keys and values: `https://api.step.parts/v1/parts?q=lengthMm%2012`
- Find ISO 4762 socket head cap screws: `https://api.step.parts/v1/parts?category=fastener&family=socket-head-cap-screw&standard=ISO%204762`
- Fetch one part and then download its STEP file from `downloadUrl`: `https://api.step.parts/v1/parts/din913_set_screw_m3x3`

## Verification

```bash
npm run check
```

`npm run check` runs the non-mutating catalog check, ESLint, and a production build. For faster local commit checks, install the repository hook once:

```bash
npm run hooks:install
```

The pre-commit hook runs `npm run check:commit`, which verifies generated catalog/assets and linting without the slower production build. GitHub Actions intentionally runs `npm run check:ci` on pull requests and pushes to `main`; that CI gate skips LFS hydration and STEP-content catalog validation.

## Git LFS And Vercel

STEP/STP assets in `catalog/step` are tracked by Git LFS through `.gitattributes`. GLB/PNG previews are Vercel Blob assets and are not committed. CI and Vercel deployments are configured not to download LFS objects for now, so full catalog validation and preview asset generation are manual/local operations.

Canonical STEP files live in `catalog/step` so local development and catalog validation read the same files used to generate `catalog/parts.sqlite`. Production STEP URLs use GitHub LFS media instead of deployed static files. By default production uses `VERCEL_GIT_COMMIT_SHA`, falling back to `main`; set `STEP_PARTS_GITHUB_REF` to override the ref, and set `STEP_PARTS_GITHUB_REPOSITORY` or `STEP_PARTS_GITHUB_OWNER` plus `STEP_PARTS_GITHUB_REPO` to override the repository. Set `STEP_PARTS_STEP_ASSET_MODE=local` only for a production-like local run that should serve checked-out STEP files directly.

See `.env.example` for the supported deployment environment variables.

For production download ranking, attach a Neon database through the Vercel Marketplace or add the database connection string manually:

- `DATABASE_URL`

Set `NEXT_PUBLIC_SITE_URL=https://www.step.parts` and `NEXT_PUBLIC_API_URL=https://api.step.parts` in Vercel, then add `www.step.parts` and `api.step.parts` as domains on the same project. The `api.step.parts` domain serves the `/v1` API routes; the app's CORS headers allow browser and non-browser clients to call them directly.
