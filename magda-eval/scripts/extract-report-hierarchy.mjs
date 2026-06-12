#!/usr/bin/env node
/**
 * Enrich existing GeoSQL eval JSON reports with case hierarchy + stratified rollup.
 * Does not re-run eval — reads report + magda-eval/cases/*.jsonl only.
 *
 * Usage:
 *   node magda-eval/scripts/extract-report-hierarchy.mjs <report.json>
 *   node magda-eval/scripts/extract-report-hierarchy.mjs eval_report/magda-geosql-eval-all-*.json
 *   node magda-eval/scripts/extract-report-hierarchy.mjs report.json --out ./out --csv
 *
 * Outputs (next to report or --out dir):
 *   <basename>-hierarchy.json   enriched report + hierarchy_summary
 *   <basename>-hierarchy.csv  flat rollup (optional --csv)
 *   <basename>-cases.csv       per-case row with hierarchy + metrics
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    classifyCase,
    evalMetricsFromCase,
    flattenRollup,
    loadCaseHierarchyIndex,
    rollupHierarchy
} from "./caseHierarchy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
    console.error(`Usage: node magda-eval/scripts/extract-report-hierarchy.mjs <report.json> [--out dir] [--csv] [--no-enrich]

Options:
  --out <dir>     Write outputs here (default: same dir as report)
  --csv           Also write flat hierarchy rollup CSV
  --no-enrich     Only write summary/CSV; do not copy full report JSON
`);
    process.exit(1);
}

/**
 * @typedef {object} ReportCaseRow
 * @property {string} case_id
 * @property {object} [layer_a]
 * @property {object} [layer_b]
 * @property {string} [model_sql_final]
 * @property {object} [hierarchy]
 */

/**
 * @param {unknown} report
 * @returns {{ datasets: Array<{ meta?: object, summary?: object, cases: ReportCaseRow[] }>, meta?: object }}
 */
function normalizeReport(report) {
    if (report.datasets && Array.isArray(report.datasets)) {
        return report;
    }
    if (report.cases && Array.isArray(report.cases)) {
        return {
            meta: report.meta || {},
            datasets: [
                {
                    meta: report.meta || {},
                    summary: report.summary,
                    cases: report.cases
                }
            ]
        };
    }
    throw new Error("Unrecognized report shape: need datasets[] or cases[]");
}

/**
 * @param {ReportCaseRow[]} cases
 * @param {Map<string, ReturnType<classifyCase>>} index
 */
function enrichCases(cases, index) {
    const missing = [];
    for (const c of cases) {
        const h = index.get(c.case_id);
        if (!h) {
            missing.push(c.case_id);
            continue;
        }
        c.hierarchy = h;
        if (!c.tags && h.aux_tags?.length) {
            c.tags = [
                h.target_pattern,
                h.difficulty,
                h.answer_shape,
                ...h.aux_tags
            ].filter(Boolean);
        }
    }
    if (missing.length) {
        console.warn(
            `Warning: ${missing.length} case_id(s) not in magda-eval/cases: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}`
        );
    }
}

/**
 * @param {ReturnType<normalizeReport>} report
 * @param {Map<string, ReturnType<classifyCase>>} index
 */
function buildExtraction(report, index) {
    /** @type {Array<{ hierarchy: ReturnType<classifyCase>, metrics: ReturnType<evalMetricsFromCase>, case_id: string, dataset_slug: string }>} */
    const allRows = [];

    for (const ds of report.datasets) {
        const slug = ds.meta?.dataset_slug || "unknown";
        enrichCases(ds.cases, index);
        for (const c of ds.cases) {
            if (!c.hierarchy) continue;
            allRows.push({
                case_id: c.case_id,
                dataset_slug: c.hierarchy.dataset_slug || slug,
                hierarchy: c.hierarchy,
                metrics: evalMetricsFromCase(c)
            });
        }
    }

    const overall = rollupHierarchy(allRows);
    const by_dataset = {};
    for (const ds of report.datasets) {
        const slug = ds.meta?.dataset_slug || "unknown";
        const subset = allRows.filter((r) => r.dataset_slug === slug);
        by_dataset[slug] = rollupHierarchy(subset);
    }

    const by_family = rollupHierarchy(allRows);
    // Re-root only family level for compact view
    const familyOnly = allRows.map((r) => ({
        hierarchy: { ...r.hierarchy, dataset_slug: r.hierarchy.family },
        metrics: r.metrics
    }));

    return {
        generated_at: new Date().toISOString(),
        source_framework: report.meta?.framework,
        eval_pipeline: report.datasets[0]?.meta?.eval_pipeline,
        llm_provider: report.datasets[0]?.meta?.llm_provider,
        total_cases: allRows.length,
        overall,
        by_dataset,
        by_family: rollupHierarchy(
            allRows.map((r) => ({
                hierarchy: {
                    ...r.hierarchy,
                    dataset_slug: r.hierarchy.family,
                    path: [
                        r.hierarchy.family,
                        r.hierarchy.target_pattern,
                        r.hierarchy.subtype,
                        r.hierarchy.difficulty,
                        r.hierarchy.answer_shape
                    ].join("/")
                },
                metrics: r.metrics
            }))
        ),
        flat_rollup: flattenRollup(overall),
        per_case: allRows.map((r) => ({
            case_id: r.case_id,
            dataset_slug: r.dataset_slug,
            path: r.hierarchy.path,
            family: r.hierarchy.family,
            target_pattern: r.hierarchy.target_pattern,
            subtype: r.hierarchy.subtype,
            difficulty: r.hierarchy.difficulty,
            answer_shape: r.hierarchy.answer_shape,
            layer_b_pass: r.metrics.layer_b_pass,
            epr_pass: r.metrics.epr_pass,
            routing: r.metrics.routing,
            error_bucket: r.metrics.error_bucket
        }))
    };
}

function toCsv(rows, columns) {
    const esc = (v) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = columns.join(",");
    const body = rows.map((r) => columns.map((c) => esc(r[c])).join(","));
    return [header, ...body].join("\n");
}

function main() {
    const args = process.argv.slice(2);
    if (!args.length || args.includes("-h") || args.includes("--help")) {
        usage();
    }
    const reportPath = path.resolve(args.find((a) => !a.startsWith("-")) || "");
    if (!reportPath || !fs.existsSync(reportPath)) {
        console.error("Report file not found:", reportPath);
        usage();
    }
    let outDir = path.dirname(reportPath);
    let writeCsv = false;
    let enrich = true;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--out" && args[i + 1]) {
            outDir = path.resolve(args[++i]);
        } else if (args[i] === "--csv") {
            writeCsv = true;
        } else if (args[i] === "--no-enrich") {
            enrich = false;
        }
    }
    fs.mkdirSync(outDir, { recursive: true });

    const base = path.basename(reportPath, path.extname(reportPath));
    const index = loadCaseHierarchyIndex();
    const raw = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const report = normalizeReport(raw);
    const extraction = buildExtraction(report, index);

    const summaryOnlyPath = path.join(outDir, `${base}-hierarchy-summary.json`);
    fs.writeFileSync(summaryOnlyPath, JSON.stringify(extraction, null, 2), "utf8");

    if (enrich) {
        const enriched = {
            ...raw,
            hierarchy_extraction: {
                generated_at: extraction.generated_at,
                taxonomy_version: "1",
                overall: {
                    n: extraction.overall.n,
                    layer_b_rate: extraction.overall.layer_b_rate,
                    epr_rate: extraction.overall.epr_rate,
                    routing_rate: extraction.overall.routing_rate
                },
                by_dataset: Object.fromEntries(
                    Object.entries(extraction.by_dataset).map(([k, v]) => [
                        k,
                        {
                            n: v.n,
                            layer_b_rate: v.layer_b_rate,
                            epr_rate: v.epr_rate,
                            routing_rate: v.routing_rate
                        }
                    ])
                )
            }
        };
        if (enriched.datasets) {
            for (const ds of enriched.datasets) {
                enrichCases(ds.cases, index);
            }
        } else if (enriched.cases) {
            enrichCases(enriched.cases, index);
        }
        const enrichedPath = path.join(outDir, `${base}-hierarchy.json`);
        fs.writeFileSync(enrichedPath, JSON.stringify(enriched, null, 2), "utf8");
        console.log("Wrote", enrichedPath);
    }

    const casesCsvPath = path.join(outDir, `${base}-cases.csv`);
    fs.writeFileSync(
        casesCsvPath,
        toCsv(extraction.per_case, [
            "case_id",
            "dataset_slug",
            "path",
            "family",
            "target_pattern",
            "subtype",
            "difficulty",
            "answer_shape",
            "layer_b_pass",
            "epr_pass",
            "routing",
            "error_bucket"
        ]),
        "utf8"
    );
    console.log("Wrote", summaryOnlyPath);
    console.log("Wrote", casesCsvPath);

    if (writeCsv) {
        const rollupCsvPath = path.join(outDir, `${base}-hierarchy.csv`);
        fs.writeFileSync(
            rollupCsvPath,
            toCsv(extraction.flat_rollup, [
                "path",
                "n",
                "layer_b_pass",
                "layer_b_rate",
                "epr_pass",
                "epr_rate",
                "routing",
                "has_sql"
            ]),
            "utf8"
        );
        console.log("Wrote", rollupCsvPath);
    }

    const o = extraction.overall;
    console.log(
        `\nOverall: n=${o.n} Layer B=${(o.layer_b_rate * 100).toFixed(1)}% EPR=${(o.epr_rate * 100).toFixed(1)}% routing=${o.routing}`
    );
}

main();
