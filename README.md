# Capstone Final Project Artifacts

This repository contains the source artifacts for our capstone project, built on top of [Magda](https://github.com/magda-io/magda) — an open-source data catalog platform.

## Contents

| Directory | Description |
|-----------|-------------|
| `magda/` | Custom Magda fork with capstone features and modifications |
| `magda-eval/` | Evaluation cases, scripts, and reports produced during development |
| `magda-llm-service-worker-extension/` | LLM service worker extension for Magda |

## magda-eval

`magda-eval` holds the evaluation harness and reports generated throughout the project. It includes test cases, run scripts, and summarized results used to measure and iterate on GeoSQL and related features.

## Differences from upstream Magda

The tables below summarize how our forks diverge from the official Magda repositories (`magda-io/magda` and `magda-io/magda-llm-service-worker-extension` on `main`).

### `magda/`

**Baseline:** [magda-io/magda](https://github.com/magda-io/magda) `main`  
**Fork branch:** `feat/geosql-deterministic-renderer` (25 commits ahead; ~15.5k lines added across 65 files)

| Area | Changes |
|------|---------|
| **GeoSQL chatbot** | New `queryGeoDataset` tool that turns natural-language questions into PostGIS SQL. Includes a task-spec interpreter, scope extractor, place resolver, deterministic SQL renderer, and one-shot SQL repair on execution errors. |
| **Browser PostGIS** | In-browser spatial querying via PGlite + PostGIS (`pglitePostgis.ts`). GeoJSON/Shapefile distributions are imported into a local `features` table for SQL execution. |
| **Spatial routing** | `spatialIntentRouter` and chatbot agent-chain updates route dataset-page questions to GeoSQL when a spatial distribution is available. |
| **Maps & preview** | Expanded `GeoJsonViewer` (Leaflet) for map preview of query results; improved SQL Console with GeoSQL-aware workflows. |
| **Eval runner (in-app)** | `GeoSqlEvalRunnerPage` plus helpers for metrics, checkpoints, row fingerprints, and report generation. Supports WebLLM and OpenAI backends; includes ablation modes (e.g. baseline direct SQL, full planner). |
| **Web server proxy** | New `/api/geo/proxy` endpoint with SSRF protections to fetch remote GeoJSON through the Magda web server (bypassing browser CORS limits). |
| **Dependencies** | Adds `@electric-sql/pglite`, `@electric-sql/pglite-postgis`, `@tmcw/togeojson`, `shpjs`; bumps `@mlc-ai/web-llm` to `^0.2.82`. |
| **LLM runtime** | Serializes WebLLM calls (`webLlmSerial.ts`), resets chat context before planner invocations, and logs token usage for eval runs. |

Most changes live in `magda-web-client/`; `magda-web-server/` adds only the geo proxy route.

### `magda-llm-service-worker-extension/`

**Baseline:** [magda-io/magda-llm-service-worker-extension](https://github.com/magda-io/magda-llm-service-worker-extension) `main`  
**Fork branch:** `main` (1 commit ahead)

| Area | Changes |
|------|---------|
| **WebLLM runtime** | Bumps `@mlc-ai/web-llm` from `0.2.73` to `^0.2.82` so the Chrome extension background worker matches the version used by the forked Magda web client. |

No functional or UI changes to the extension itself — only a dependency update to stay compatible with the capstone GeoSQL / eval stack.
