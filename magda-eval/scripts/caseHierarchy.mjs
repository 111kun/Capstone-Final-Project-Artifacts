/**
 * Deterministic hierarchy labels for magda-eval cases (dataset-agnostic).
 * Used by validate-cases.mjs and extract-report-hierarchy.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CASES_DIR = path.join(__dirname, "..", "cases");

export const PATTERN_TAGS = new Set([
    "FILTER_COUNT",
    "AGGREGATE_GROUP_BY",
    "LIST_ROWS",
    "MEASUREMENT",
    "SPATIAL_FILTER",
    "SPATIAL_NEAREST",
    "SPATIAL_TOPOLOGY",
    "MIXED"
]);

/** L1 capability family (report rollup) */
export const FAMILY_BY_PATTERN = {
    FILTER_COUNT: "A_计数",
    AGGREGATE_GROUP_BY: "B_分组排名",
    LIST_ROWS: "C_明细列表",
    MEASUREMENT: "D_量算聚合",
    SPATIAL_FILTER: "E_空间过滤计数",
    SPATIAL_NEAREST: "F_最近邻",
    SPATIAL_TOPOLOGY: "E_空间过滤计数",
    MIXED: "G_复合",
    UNKNOWN: "Z_其他"
};

/**
 * @param {{ id: string, dataset_slug: string, question?: string, tags?: string[] }} caseRow
 * @returns {{
 *   case_id: string,
 *   dataset_slug: string,
 *   family: string,
 *   target_pattern: string,
 *   subtype: string,
 *   difficulty: string,
 *   answer_shape: string,
 *   path: string,
 *   aux_tags: string[]
 * }}
 */
export function classifyCase(caseRow) {
    const tags = caseRow.tags || [];
    const question = String(caseRow.question || "");
    const qLow = question.toLowerCase();

    const target_pattern =
        tags.find((t) => PATTERN_TAGS.has(t)) || "UNKNOWN";
    const difficulty = tags.find((t) => t === "L1" || t === "L2" || t === "L3") || "?";
    const answer_shape =
        tags.find((t) => t === "scalar" || t === "rows") || "?";
    const family = FAMILY_BY_PATTERN[target_pattern] || FAMILY_BY_PATTERN.UNKNOWN;

    const aux_tags = tags.filter(
        (t) =>
            !PATTERN_TAGS.has(t) &&
            t !== "L1" &&
            t !== "L2" &&
            t !== "L3" &&
            t !== "scalar" &&
            t !== "rows"
    );

    let subtype = "-";
    if (target_pattern === "FILTER_COUNT") {
        if (/distinct/i.test(question)) {
            subtype = "C3_distinct计数";
        } else if (aux_tags.includes("geometry_type")) {
            subtype = "C4_几何类型计数";
        } else if (aux_tags.includes("ilike")) {
            subtype = "C2_模糊过滤";
        } else if (aux_tags.includes("filter")) {
            subtype = "C1_等值过滤";
        } else {
            subtype = "C0_全表计数";
        }
    } else if (target_pattern === "AGGREGATE_GROUP_BY") {
        if (aux_tags.includes("geometry_type")) {
            subtype = "B3_按几何分组";
        } else if (difficulty === "L3") {
            subtype = "B2_条件后TopN";
        } else {
            subtype = "B1_TopN分组";
        }
    } else if (target_pattern === "LIST_ROWS") {
        subtype = aux_tags.includes("filter") ? "L2_过滤列表" : "L1_排序列表";
    } else if (target_pattern === "MEASUREMENT") {
        subtype = aux_tags.includes("geography_measure")
            ? "D2_几何量算"
            : "D1_属性量算";
        if (/perimeter|周长/i.test(question)) {
            subtype = "D2a_周长量算";
        } else if (/length|长度/i.test(question) && !/perimeter|周长/i.test(question)) {
            subtype = "D2b_长度量算";
        } else if (/area|面积/i.test(question) && subtype.startsWith("D2")) {
            subtype = "D2c_面积量算";
        }
    } else if (target_pattern === "SPATIAL_FILTER") {
        if (aux_tags.includes("spatial_predicate")) {
            subtype = "E2_有效性谓词";
        } else if (aux_tags.includes("subquery")) {
            subtype = "E3_子查询对比均值";
        } else if (aux_tags.includes("geometry_type")) {
            subtype = "E4_几何类型";
        } else {
            subtype = "E1_度量阈值";
        }
    } else if (target_pattern === "SPATIAL_NEAREST") {
        subtype = "F1_集内参考距离";
    } else if (target_pattern === "MIXED") {
        if (aux_tags.includes("subquery")) {
            subtype = "G2_子查询对比";
        } else if (
            aux_tags.includes("geography_measure") &&
            aux_tags.includes("spatial_predicate")
        ) {
            subtype = "G3_谓词加度量";
        } else {
            subtype = "G1_多条件计数";
        }
    }

    const path = [
        caseRow.dataset_slug,
        family,
        target_pattern,
        subtype,
        difficulty,
        answer_shape
    ].join("/");

    return {
        case_id: caseRow.id,
        dataset_slug: caseRow.dataset_slug,
        family,
        target_pattern,
        subtype,
        difficulty,
        answer_shape,
        path,
        aux_tags
    };
}

/** @returns {Map<string, ReturnType<classifyCase>>} */
export function loadCaseHierarchyIndex(casesDir = CASES_DIR) {
    const index = new Map();
    const files = fs
        .readdirSync(casesDir)
        .filter((f) => f.endsWith(".jsonl"))
        .sort();
    for (const file of files) {
        const fp = path.join(casesDir, file);
        const lines = fs
            .readFileSync(fp, "utf8")
            .split(/\r?\n/)
            .filter((l) => l.trim());
        for (const line of lines) {
            const row = JSON.parse(line);
            const h = classifyCase(row);
            index.set(h.case_id, h);
        }
    }
    return index;
}

/**
 * @param {import('./extract-report-hierarchy.mjs').ReportCaseRow} caseResult
 * @param {ReturnType<classifyCase>} hierarchy
 */
export function evalMetricsFromCase(caseResult) {
    const la = caseResult.layer_a || {};
    const lb = caseResult.layer_b || {};
    return {
        layer_b_pass: !!lb.result_match,
        epr_pass: !!la.execution_pass_final,
        sa_pass: !!la.syntax_accuracy_final,
        routing: la.error_bucket_final === "routing",
        has_sql: !!(caseResult.model_sql_final || "").trim(),
        error_bucket: la.error_bucket_final || "none"
    };
}

/**
 * Build nested rollup tables for report stratification.
 * @param {Array<{ hierarchy: ReturnType<classifyCase>, metrics: ReturnType<evalMetricsFromCase> }>} rows
 */
export function rollupHierarchy(rows) {
    /** @type {Record<string, any>} */
    const root = { n: 0, layer_b_pass: 0, epr_pass: 0, routing: 0, has_sql: 0 };

    const bump = (node, metrics) => {
        node.n += 1;
        if (metrics.layer_b_pass) node.layer_b_pass += 1;
        if (metrics.epr_pass) node.epr_pass += 1;
        if (metrics.routing) node.routing += 1;
        if (metrics.has_sql) node.has_sql += 1;
    };

    const ensure = (parent, key) => {
        if (!parent.children) parent.children = {};
        if (!parent.children[key]) {
            parent.children[key] = {
                n: 0,
                layer_b_pass: 0,
                epr_pass: 0,
                routing: 0,
                has_sql: 0
            };
        }
        return parent.children[key];
    };

    for (const { hierarchy: h, metrics } of rows) {
        bump(root, metrics);
        let node = root;
        for (const key of [
            h.dataset_slug,
            h.family,
            h.target_pattern,
            h.subtype,
            h.difficulty,
            h.answer_shape
        ]) {
            node = ensure(node, key);
            bump(node, metrics);
        }
    }

    const attachRates = (node) => {
        node.layer_b_rate = node.n ? node.layer_b_pass / node.n : 0;
        node.epr_rate = node.n ? node.epr_pass / node.n : 0;
        node.routing_rate = node.n ? node.routing / node.n : 0;
        if (node.children) {
            for (const child of Object.values(node.children)) {
                attachRates(child);
            }
        }
    };
    attachRates(root);
    return root;
}

/**
 * Flatten rollup to CSV-friendly rows.
 * @param {ReturnType<rollupHierarchy>} node
 * @param {string} [prefix]
 */
export function flattenRollup(node, prefix = "") {
    /** @type {Array<Record<string, string|number>>} */
    const out = [];
    const path = prefix || "(all)";
    out.push({
        path,
        n: node.n,
        layer_b_pass: node.layer_b_pass,
        layer_b_rate: Number((node.layer_b_rate * 100).toFixed(1)),
        epr_pass: node.epr_pass,
        epr_rate: Number((node.epr_rate * 100).toFixed(1)),
        routing: node.routing,
        has_sql: node.has_sql
    });
    if (node.children) {
        for (const [key, child] of Object.entries(node.children).sort(([a], [b]) =>
            a.localeCompare(b)
        )) {
            const childPath = prefix ? `${prefix}/${key}` : key;
            out.push(...flattenRollup(child, childPath));
        }
    }
    return out;
}
