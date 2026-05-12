---
name: step-parts
description: Find, evaluate, and download low-level common standard CAD parts from step.parts, such as screws, bolts, nuts, washers, bearings, standoffs, electronics parts, motors, connectors, and other off-the-shelf components. Use when Codex needs to search the hosted step.parts catalog, resolve fuzzy part names, standards, aliases, or dimensions, choose a matching part, fetch a canonical .step file, verify checksums, or use the step.parts API/OpenAPI/catalog endpoints for standard part discovery.
---

# CAD Parts

## Overview

Use the hosted step.parts machine endpoints instead of scraping HTML or relying on local repository files. Treat `https://api.step.parts` as the canonical API origin and `https://www.step.parts` as the site/static-asset origin unless the user provides a different hosted mirror. If the domain does not resolve or the API is unavailable, report that the hosted service is not reachable yet instead of falling back to repo-specific assumptions.

## Quick Workflow

1. Interpret the requested part into search terms and optional facets:
   - `q` for fuzzy tokens, standards, aliases, dimensions, source/product URLs, and attribute names/values.
   - `category`, `family`, `standard`, or `tag` when the user gives an exact facet.
2. Search `/v1/parts` and inspect `items`, `total`, and `facets`.
3. If results are ambiguous, present the best few options with `id`, `name`, `standard`, and key attributes before choosing. If one result clearly matches, return the selected record details without downloading unless the user asked for a local STEP file.
4. When the user asks to download or save a STEP file, download its `downloadUrl` so the internal download count is updated, then verify the file with the record's `sha256` when present.
5. Return the local path when downloaded, plus the selected part id and page/API URLs so the user can trace provenance.

## Bundled Downloader

Use `scripts/download_step_part.py` for deterministic search, download, and checksum verification:

```bash
python skills/step-parts/scripts/download_step_part.py "M3 socket head 12" --download --out-dir /tmp/step-parts
python skills/step-parts/scripts/download_step_part.py --id iso4762_socket_head_cap_screw_m3x12 --download --out-dir /tmp/step-parts
python skills/step-parts/scripts/download_step_part.py "bearing 608zz" --limit 5
```

Useful options:

- `--origin`: override `https://api.step.parts` only when the user provides another hosted API origin.
- `--tag`, `--category`, `--family`, `--standard`: repeatable facet filters.
- `--out-dir`: directory for downloaded STEP files. Defaults to `/tmp/step-parts`.
- `--all`: with `--download`, download every result on the returned page as individual STEP downloads.
- `--overwrite`: replace an existing output file.

The script prints JSON to stdout. For searches, it prints matched records. For downloads, it prints saved file paths, checksums, and source URLs.

## API Reference

Read `references/step-parts-api.md` when you need endpoint details, field meanings, or query semantics. Prefer:

- `/v1/parts` for filtered search with absolute asset URLs.
- `/v1/parts/{id}` for one enriched record.
- `/v1/parts/{id}/download` or returned `downloadUrl` for counted STEP downloads.
- `/v1/catalog/parts.index.json` for a compact discovery index.
- `/v1/catalog/schema` for field and family attribute meanings.
- `/v1/openapi.json` when generating a client or tool.

## Search Guidance

- Query tokens are ANDed by the API, so start specific but not overconstrained. For example, use `M3 SHCS 12` before adding exact family and standard filters.
- Values within one facet are ORed together, and selected `tag`, `category`, `family`, and `standard` fields are ANDed together. Use exact facets to narrow within known categories, then rank manually by name and attributes.
- Standards can be queried as `ISO 4762`, `ISO4762`, or the exact `standard.designation`.
- The `attributes` object contains family-specific facts such as `thread`, `lengthMm`, `bore1Mm`, `material`, `profileSeries`, `slotSizeMm`, and dimensions in millimeters.
- Part, GLB, and PNG URL patterns are predictable on `https://www.step.parts`; STEP URLs are environment-aware and may resolve to GitHub LFS media in production. Use API `downloadUrl` for downloads and catalog/API `stepUrl` only when the user explicitly needs the canonical asset URL.
