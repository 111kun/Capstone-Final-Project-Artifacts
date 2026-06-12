# GeoSQL Agent 优化路线图（基于 GPT 策略反馈）

> 基线提交：`feat/geosql-planner-slim`（magda）/ `feat/geosql-baseline-direct-sql`（Capstone）  
> 本分支：`feat/geosql-deterministic-renderer` — **仅规划与分阶段实现，不破坏已保存的 P0 成果**

## 当前成绩（OpenAI gpt-4o-mini, agent）

| 报告 | Layer B | routing |
|------|---------|---------|
| 03-30-48（P0 后） | **51.4% (37/72)** | 2 |
| baseline_direct | ~69% | — |

**瓶颈**：Planner 自由生成 SQL；LIST_ROWS 0/8；GROUP BY 全 schema 列；scope 字段绑错。

## 架构转向（核心）

```text
旧：Question → scope → task-spec → Planner LLM → contract → rewrite → SQL
新：Question → Intent → Executable AST → Deterministic SQL Renderer → SQL
                                      ↘（仅 SPATIAL_COMPLEX）Spatial Planner LLM
```

**原则**：系统规划 SQL；小模型只做分类 / tagging / extraction（面向本地 8B）。

---

## Phase 1 — 最高 ROI（本分支首要目标）

**状态**：已实现（`executableAst.ts`, `sqlRenderer.ts`, `columnSemanticHints.ts`, `planGeoSqlQuery` 接入）

**目标**：LIST_ROWS / FILTER_COUNT / GROUP_BY / MEASUREMENT **不再经 Planner 出主 SQL**。

| 任务 | 文件 | 说明 |
|------|------|------|
| 1.1 定义 `ExecutableAst` | `geoQueryTaskInterpreter.ts` 或新 `executableAst.ts` | selectColumns, filters, grouping, ordering, limit, measurement, spatialOp |
| 1.2 `astFromTaskSpec()` | 同上 | 从现有 plan + scope 确定性构建 AST |
| 1.3 `renderSqlFromAst()` | 新 `sqlRenderer.ts` 或 `queryGeoDataset.ts` | LIST / COUNT / GROUP BY / MEASUREMENT 模板 |
| 1.4 接入主链路 | `queryGeoDataset.ts` | `target_pattern` ∈ 上述四类 → 直接用 renderer；仅 `SPATIAL_*` / `MIXED` 复杂空间走 Planner |
| 1.5 弱化 rewrite | `queryGeoDataset.ts` | renderer 成功则跳过 contract LLM rewrite |
| 1.6 保留 sanitizer | `sql.ts` | JSONB、裸列名修正；无 LIMIT 100 |

**验收（预估）**：LIST_ROWS 0/8 → 6/8+；GROUP_BY 3/11 → 7/11；总体 51% → **63~68%**。

---

## Phase 2 — GROUP BY 与 FILTER 加固

| 任务 | 说明 |
|------|------|
| 2.1 Minimal GROUP BY | SELECT 仅 grouping 列 + 一个 aggregate；禁止全 schema GROUP BY |
| 2.2 FILTER 不丢 binding | `filters[]` → WHERE；禁止 `COUNT(*) WHERE TRUE`（有 binding 时） |
| 2.3 DISTINCT | `COUNT(DISTINCT key)` 走 renderer |
| 2.4 数值 cast | lat / shape_Area 等 `::double precision` 规则 |

---

## Phase 3 — Schema linking ontology

| 任务 | 文件 | 说明 |
|------|------|------|
| 3.1 列语义词典 | 新 `columnSemanticHints.ts` | commercial→dev_catego, zone code→zone, label→zone_meani |
| 3.2 优先于 value_sample | `scopeExtractor.ts` | keyword prior + sample 校验 |
| 3.3 residential / open space | 同上 | 减少 zone_meani vs dev_catego 混淆 |

---

## Phase 4 — 空间复杂题（保留 LLM）

仅以下走 Spatial Planner：

- SPATIAL_NEAREST（trees-021）
- ST_DWithin + EXISTS（trees-020）
- 多条件空间子查询（road-021/022, zones-021）

Planner prompt **仅**服务此类；schema 裁剪到 spatial 相关键。

---

## 不在此分支范围

- eval_report/ 下 JSON（已 gitignore，本地保留）
- WebLLM 8B 量化调优（依赖 Phase 1 renderer 后再测）
- 修改 gold_sql / 评测 harness 规则

---

## 参考文档（本地）

- `eval_report/GeoSQL-Agent-现状与问题-咨询稿.md`（gitignore）
- `eval_report/geosql_agent_8_b_optimization_strategy_md.md`（gitignore，GPT 全文）

---

## 分支约定

| 仓库 | 保存 P0 的分支 | 规划/实现分支 |
|------|----------------|---------------|
| `magda` | `feat/geosql-planner-slim` | `feat/geosql-deterministic-renderer` |
| `Capstone` | `feat/geosql-baseline-direct-sql` | `feat/geosql-deterministic-renderer` |

```bash
# 开发前
cd magda && git checkout feat/geosql-deterministic-renderer
cd .. && git checkout feat/geosql-deterministic-renderer
```
