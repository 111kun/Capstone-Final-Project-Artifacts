#!/usr/bin/env node
/**
 * Batch hierarchy extraction + cross-run comparison for eval_report/report_final.
 *
 * Usage:
 *   node magda-eval/scripts/summarize-report-final.mjs
 *   node magda-eval/scripts/summarize-report-final.mjs --dir eval_report/report_final
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { flattenRollup } from "./caseHierarchy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");

const RUN_LABELS = {
    "2026-05-22T12-53-49-966Z": {
        id: "baseline_openai",
        label: "Baseline direct · OpenAI",
        pipeline: "baseline_direct",
        role: "reference_upper_bound"
    },
    "2026-05-22T14-16-02-325Z": {
        id: "baseline_webllm",
        label: "Baseline direct · WebLLM",
        pipeline: "baseline_direct",
        role: "reference_webllm_unstable"
    },
    "2026-05-23T04-51-09-236Z": {
        id: "agent_det_webllm",
        label: "Agent deterministic · WebLLM",
        pipeline: "agent",
        role: "production_default"
    },
    "2026-05-23T04-52-26-632Z": {
        id: "agent_det_openai",
        label: "Agent deterministic · OpenAI",
        pipeline: "agent",
        role: "production_openai"
    },
    "2026-05-23T08-24-57-793Z": {
        id: "agent_planner_webllm",
        label: "Agent planner-only · WebLLM",
        pipeline: "agent_full_planner",
        role: "ablation_no_deterministic"
    },
    "2026-05-23T08-32-30-888Z": {
        id: "agent_planner_openai",
        label: "Agent planner-only · OpenAI",
        pipeline: "agent_full_planner",
        role: "ablation_no_deterministic"
    }
};

function parseArgs() {
    const args = process.argv.slice(2);
    let dir = path.join(REPO_ROOT, "eval_report", "report_final");
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--dir" && args[i + 1]) {
            dir = path.resolve(args[++i]);
        }
    }
    return { dir };
}

function stampFromReportName(name) {
    const m = name.match(/(\d{4}-\d{2}-\d{2}T[\d-]+Z)/);
    return m ? m[1] : name;
}

function runMetaForReport(reportPath) {
    const stamp = stampFromReportName(path.basename(reportPath));
    const preset = RUN_LABELS[stamp] || {
        id: stamp,
        label: stamp,
        pipeline: "unknown",
        role: "other"
    };
    const raw = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const ds0 = raw.datasets?.[0]?.meta || {};
    return {
        stamp,
        report_file: path.basename(reportPath),
        run_id: preset.id,
        label: preset.label,
        pipeline: ds0.eval_pipeline || preset.pipeline,
        llm_provider: ds0.llm_provider || raw.meta?.llm_provider,
        openai_model: ds0.openai_model,
        role: preset.role,
        generated_at: raw.meta?.generated_at,
        wall_s: Math.round((raw.meta?.run_timing?.wall_ms || 0) / 1000),
        llm_calls: raw.meta?.llm_usage_total?.call_count,
        llm_tokens: raw.meta?.llm_usage_total?.total_tokens
    };
}

function extractHierarchy(reportPath, outDir) {
    const script = path.join(__dirname, "extract-report-hierarchy.mjs");
    const r = spawnSync(
        process.execPath,
        [script, reportPath, "--out", outDir, "--csv", "--no-enrich"],
        { encoding: "utf8", cwd: REPO_ROOT }
    );
    if (r.status !== 0) {
        console.error(r.stderr || r.stdout);
        throw new Error(`extract failed: ${reportPath}`);
    }
}

function pct(rate) {
    return Number((rate * 100).toFixed(1));
}

function familyRowsFromSummary(summary) {
    const byFamily = summary.by_family;
    if (!byFamily?.children) return [];
    return Object.entries(byFamily.children).map(([family, node]) => ({
        family,
        n: node.n,
        layer_b_rate: pct(node.layer_b_rate),
        epr_rate: pct(node.epr_rate),
        routing_rate: pct(node.routing_rate)
    }));
}

function datasetRowsFromSummary(summary) {
    const rows = [];
    for (const [slug, tree] of Object.entries(summary.by_dataset || {})) {
        rows.push({
            dataset_slug: slug,
            n: tree.n,
            layer_b_rate: pct(tree.layer_b_rate),
            epr_rate: pct(tree.epr_rate),
            routing_rate: pct(tree.routing_rate)
        });
    }
    return rows;
}

function toCsv(rows, columns) {
    const esc = (v) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join(
        "\n"
    );
}

function main() {
    const { dir } = parseArgs();
    fs.mkdirSync(dir, { recursive: true });

    const reports = fs
        .readdirSync(dir)
        .filter(
            (f) =>
                f.startsWith("magda-geosql-eval-all-") &&
                f.endsWith(".json") &&
                !f.includes("-hierarchy")
        )
        .sort();

    if (!reports.length) {
        console.error("No reports in", dir);
        process.exit(1);
    }

    /** @type {Array<Record<string, unknown>>} */
    const runSummaries = [];
    /** @type {Map<string, Record<string, number|string>>} */
    const familyMatrix = new Map();
    /** @type {Map<string, Record<string, number|string>>} */
    const caseMatrix = new Map();

    for (const file of reports) {
        const reportPath = path.join(dir, file);
        console.log("Processing", file);
        extractHierarchy(reportPath, dir);

        const base = file.replace(/\.json$/, "");
        const summaryPath = path.join(dir, `${base}-hierarchy-summary.json`);
        const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
        const meta = runMetaForReport(reportPath);

        const runRow = {
            ...meta,
            layer_b_rate: pct(summary.overall.layer_b_rate),
            layer_b_pass: summary.overall.layer_b_pass,
            epr_rate: pct(summary.overall.epr_rate),
            routing_count: summary.overall.routing,
            has_sql_rate: pct(
                summary.overall.n
                    ? summary.overall.has_sql / summary.overall.n
                    : 0
            ),
            by_dataset: datasetRowsFromSummary(summary),
            by_family: familyRowsFromSummary(summary)
        };
        runSummaries.push(runRow);

        for (const fr of runRow.by_family) {
            const key = fr.family;
            if (!familyMatrix.has(key)) {
                familyMatrix.set(key, { family: key, n: fr.n });
            }
            const row = familyMatrix.get(key);
            row[`${meta.run_id}_layer_b_pct`] = fr.layer_b_rate;
            row[`${meta.run_id}_epr_pct`] = fr.epr_rate;
        }

        for (const c of summary.per_case || []) {
            if (!caseMatrix.has(c.case_id)) {
                caseMatrix.set(c.case_id, {
                    case_id: c.case_id,
                    dataset_slug: c.dataset_slug,
                    family: c.family,
                    target_pattern: c.target_pattern,
                    subtype: c.subtype,
                    difficulty: c.difficulty,
                    path: c.path
                });
            }
            const row = caseMatrix.get(c.case_id);
            row[`${meta.run_id}_layer_b`] = c.layer_b_pass ? 1 : 0;
            row[`${meta.run_id}_epr`] = c.epr_pass ? 1 : 0;
            row[`${meta.run_id}_routing`] = c.routing ? 1 : 0;
        }
    }

    const comparison = {
        generated_at: new Date().toISOString(),
        report_dir: dir,
        taxonomy: "magda-eval/scripts/caseHierarchy.mjs",
        runs: runSummaries,
        writing_notes: {
            production_path: "agent_det_webllm (agent + deterministic, default in chat)",
            recommended_tables: [
                "comparison-by-run.csv",
                "comparison-by-family.csv",
                "case-matrix.csv"
            ],
            exclude_from_main_narrative: [
                "baseline_webllm — WebLLM baseline_direct collapsed (19.4% Layer B); cite only as model instability footnote"
            ]
        }
    };

    fs.writeFileSync(
        path.join(dir, "comparison-matrix.json"),
        JSON.stringify(comparison, null, 2),
        "utf8"
    );

    const runCsv = runSummaries.map((r) => ({
        run_id: r.run_id,
        label: r.label,
        pipeline: r.pipeline,
        llm_provider: r.llm_provider,
        layer_b_pct: r.layer_b_rate,
        layer_b_pass: r.layer_b_pass,
        epr_pct: r.epr_rate,
        routing: r.routing_count,
        llm_calls: r.llm_calls,
        llm_tokens: r.llm_tokens,
        wall_s: r.wall_s,
        report_file: r.report_file
    }));
    fs.writeFileSync(
        path.join(dir, "comparison-by-run.csv"),
        toCsv(runCsv, [
            "run_id",
            "label",
            "pipeline",
            "llm_provider",
            "layer_b_pct",
            "layer_b_pass",
            "epr_pct",
            "routing",
            "llm_calls",
            "llm_tokens",
            "wall_s",
            "report_file"
        ]),
        "utf8"
    );

    const familyCsv = [...familyMatrix.values()].sort((a, b) =>
        String(a.family).localeCompare(String(b.family))
    );
    if (familyCsv.length) {
        const cols = Object.keys(familyCsv[0]);
        fs.writeFileSync(
            path.join(dir, "comparison-by-family.csv"),
            toCsv(familyCsv, cols),
            "utf8"
        );
    }

    const caseCsv = [...caseMatrix.values()].sort((a, b) =>
        String(a.case_id).localeCompare(String(b.case_id))
    );
    if (caseCsv.length) {
        const cols = Object.keys(caseCsv[0]);
        fs.writeFileSync(path.join(dir, "comparison-case-matrix.csv"), toCsv(caseCsv, cols), "utf8");
    }

    console.log("\nWrote:");
    console.log(" ", path.join(dir, "comparison-matrix.json"));
    console.log(" ", path.join(dir, "comparison-by-run.csv"));
    console.log(" ", path.join(dir, "comparison-by-family.csv"));
    console.log(" ", path.join(dir, "comparison-case-matrix.csv"));
    console.log("\nPer-report: *-hierarchy-summary.json, *-cases.csv, *-hierarchy.csv");
}

main();
