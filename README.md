<h1 align="center">🔩 step.parts 🔩</h1>

[Open](https://www.step.parts)

<p align="center">
  <a href="https://nextjs.org/"><img alt="Next.js" src="https://img.shields.io/badge/Next.js-16.2.6-000000?logo=nextdotjs&amp;logoColor=white"></a>
  <a href="https://react.dev/"><img alt="React" src="https://img.shields.io/badge/React-19.2.4-149eca?logo=react&amp;logoColor=white"></a>
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&amp;logoColor=white"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
  <a href="#catalog-and-assets"><img alt="Catalog" src="https://img.shields.io/badge/catalog-STEP%20%2B%20GLB%20%2B%20PNG-2f6f73"></a>
  <a href="#git-lfs-and-vercel"><img alt="Assets" src="https://img.shields.io/badge/assets-Git%20LFS-f64935?logo=gitlfs&amp;logoColor=white"></a>
</p>

<p align="center">12,000+ open source STEP parts for your next CAD project</p>

## 🧰 Add A Part

Use the add-part helper instead of editing generated catalog fields by hand:

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
- generated GLB and PNG assets in `public/glb/` and `public/png/`
- regenerated SQLite catalog in `catalog/parts.sqlite`

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
- `catalog/parts.sqlite`: generated catalog metadata and asset build state consumed by the app
- `catalog/taxonomy.json`: guardrails for rigid, repeatable families such as standardized fasteners, washers, bearings, stock, and helper geometry
- `catalog/step/{id}.step`
- `public/glb/{id}.glb`
- `public/png/{id}.png`

`catalog/taxonomy.json` is intentionally narrow. Use it when a family has predictable identity fields and required attributes, such as `thread` plus `lengthMm` for screws or profile dimensions for stock. Do not add flexible brand, product, or one-off families just to make the taxonomy exhaustive; use existing examples in `catalog/parts.json` and the SQLite search API for those.

Generated catalog rows add stable asset URLs, STEP byte size, STEP SHA-256 checksum, and current GLB/PNG build hashes. For metadata-only changes, refresh SQLite without rebuilding preview assets:

```bash
node scripts/generate-catalog.mjs
```

When STEP files or preview assets change, run the full catalog build. The build is incremental by default: each selected STEP part is processed as a GLB/PNG pair, and a complete SQLite row is written as soon as that pair is current. Existing GLB previews and PNG thumbnails are skipped when `catalog/parts.sqlite` has matching input hashes, output hashes, and build keys.

Use `STEP_PARTS_EXPORT_CONCURRENCY` to tune paired export lanes; it defaults to `2`. Use `--force-build` to rebuild selected pairs anyway, or `--targets` to build specific outputs:

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

Targeted builds use row-level SQLite upserts, so separate targeted build processes can safely update different part sets at the same time. Full metadata-only rewrites still belong to `node scripts/generate-catalog.mjs`.

Verify that committed generated files and assets are current without rewriting anything:

```bash
npm run catalog:check
```

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

The pre-commit hook runs `npm run check:commit`, which verifies generated catalog/assets and linting without the slower production build. GitHub Actions runs the full `npm run check` gate on pull requests and pushes to `main`.

## Git LFS And Vercel

STEP/STP/GLB/PNG assets are tracked by Git LFS through `.gitattributes`. For Vercel deployments, enable Git LFS in the project Git settings and redeploy so the LFS objects are pulled into the deployment.

Canonical STEP files live in `catalog/step` so local development and catalog validation read the same files used to generate `catalog/parts.sqlite`. Production STEP URLs use GitHub LFS media instead of deployed static files. By default production uses `VERCEL_GIT_COMMIT_SHA`, falling back to `main`; set `STEP_PARTS_GITHUB_REF` to override the ref, and set `STEP_PARTS_GITHUB_REPOSITORY` or `STEP_PARTS_GITHUB_OWNER` plus `STEP_PARTS_GITHUB_REPO` to override the repository. Set `STEP_PARTS_STEP_ASSET_MODE=local` only for a production-like local run that should serve checked-out STEP files directly.

See `.env.example` for the supported deployment environment variables.

For production download ranking, attach a Neon database through the Vercel Marketplace or add the database connection string manually:

- `DATABASE_URL`

Set `NEXT_PUBLIC_SITE_URL=https://www.step.parts` and `NEXT_PUBLIC_API_URL=https://api.step.parts` in Vercel, then add `www.step.parts` and `api.step.parts` as domains on the same project. The `api.step.parts` domain serves the `/v1` API routes; the app's CORS headers allow browser and non-browser clients to call them directly.
