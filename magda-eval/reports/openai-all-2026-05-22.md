# GeoSQL 评测报告：OpenAI API 三库联跑（2026-05-22）

**原始 JSON**：`eval_report/magda-geosql-eval-all-2026-05-22T09-55-52-335Z.json`  
**生成时间（JSON meta）**：2026-05-22T09:55:52.335Z  
**模式**：`all_datasets`（land_zones → manningham_trees → road_segment，各 24 题，共 72 题）

> **说明**：本 JSON 生成于 harness 增加 `run_timing` / `llm_usage` 字段之前，文件中**不含**墙钟时间与 token 统计。复跑 `/geosql-eval` 并下载新报告后，可在 `meta.run_timing`、`meta.llm_usage_total` 及每题 `cases[].timing` / `llm_usage` 中查看。

---

## 1. 运行配置（AgentChain / LLM）

### 1.1 评测入口

| 项 | 值 |
|----|-----|
| 页面 | `/geosql-eval`（`GeoSqlEvalRunnerPage`） |
| Agent 创建 | `AgentChain.createForEval(..., { llmProvider: "openai", openAi: {...} })` |
| 单例 | 每次 Run 重置 `AgentChain.agentChain`，三库共用同一 Agent 实例（连跑） |
| 前置条件 | `enableChatbot` + `enablePglitePostgis` |

### 1.2 LLM 后端（OpenAI，非浏览器 WebLLM）

| 项 | 默认 / 说明 |
|----|-------------|
| 实现类 | `ChatEvalOpenAi` → `openAiChatEngine`（`fetch` → `/v1/chat/completions`） |
| 默认模型 | `gpt-4o-mini`（可用 `REACT_APP_OPENAI_MODEL` 或评测页 UI 覆盖） |
| 默认 Base URL | `https://api.openai.com/v1`（或 proxy URL） |
| API Key | `REACT_APP_OPENAI_API_KEY` 或评测页 `localStorage`（`magdaGeoSqlEvalOpenAiApiKey`） |
| Chrome 扩展 | **不需要**（与生产 ChatBox 的 WebLLM 路径不同） |

日志里仍可能出现文案 **「Calling WebLLM for GeoSQL JSON plan」**——这是历史日志字符串，**实际请求走 OpenAI API**。

### 1.3 生产链路（每题）

与 ChatBox 数据集页一致，评测通过 `agent.stream(question, { geoEvalCaptureExecutedSql: true })` 触发：

1. **Dataset profile**（eval 首题 warmup：`warmupOnly` 导入 PostGIS `features`，后续题复用表）
2. **Chat 路由**（`decideChatRoute` / `spatialIntentRouter`）→ 数据题一般进入 **`spatial_sql`**
3. **`queryGeoDataset`**：task-spec LLM → GeoSQL planner LLM → sanitizer / spatial contract → PostGIS 执行
4. **工具调用**：`llmInvokeTool`（与 WebLLM 共用同一套 tool 指令）
5. **串行化**：`webLlmSerial` 对 `resetChat` / `completions.create` 排队（OpenAI 引擎上 `resetChat` 为空操作）

### 1.4 捕获与计分（Harness）

| 字段 | 含义 |
|------|------|
| `evalCapturedExecutedSqlFirst` / `Final` | AgentChain 在 `queryGeoDataset` 中捕获的 SQL |
| Layer A SA | 最终 SQL 是否可读（`SELECT`/`WITH`） |
| Layer A EPR | 在 harness 内对 SQL 再执行 `runPostgisQuery` 是否成功 |
| Layer B | `gold_sql` 与模型 SQL 结果集指纹是否一致（`geoSqlEvalRowFingerprint`） |
| `repair_gain` | 首次执行失败、最终执行成功 |

---

## 2. 术语更正：`routing` 错误桶 ≠ 「未进 spatial 线路」

### 2.1 代码中的实际定义

在 `GeoSqlEvalRunnerPage.tsx` 中，**当且仅当没有捕获到最终 SQL**（`!sqlFinal`）时：

```ts
error_bucket_final: sqlFinal ? classifySqlError(errFinal) : "routing"
```

即 harness 把 **「No final executed GeoSQL captured」** 记入 **`routing` 桶**。

`classifySqlError()` 仅在 **有错误消息字符串** 时才会因 `contract|spatial_sql|route` 等关键词返回 `routing`；**无 SQL、无消息时直接标 `routing`**。

### 2.2 本报告 21 题 `routing` 桶的实证

对 JSON 中全部 `error_bucket_final === "routing"` 的 21 题统计：

| 统计项 | 数量 |
|--------|------|
| 合计 | **21** |
| 日志含 `Router action: spatial_sql` | **21 / 21** |
| 日志**未**进 spatial | **0** |
| 仍有 `model_sql_final` 却被标 routing | **0** |

**结论**：本跑中的 **`routing` 应理解为「GeoSQL 管线中断 / 未捕获最终可执行 SQL」**，而不是「完全没进入 spatial_sql 路由」。  
典型路径：已进入 spatial → task-spec / planner 已调用 → 甚至出现 `Planner generated GeoSQL` → **contract 否决或 rewrite 失败后 stream 结束**，未写入 `evalCapturedExecutedSql`。

示例（zones-007）：生成 `SUM(properties->>'shape_Area')` → **Spatial contract violation**（要求 ST_Area/ST_Length）→ 尝试 rewrite → **无最终 SQL** → harness 标 `routing`。

### 2.3 建议在论文 / 后续指标中区分

| 概念 | 建议名称 | 本跑如何观察 |
|------|----------|--------------|
| 未进 spatial 数据线路 | **route_miss** | 查 `system_logs` 无 `Router action: spatial_sql` |
| 进了 spatial 但无最终 SQL | **sql_capture_fail** / **pipeline_abort** | 当前 JSON 的 `routing` 桶 + `error_message: No final executed GeoSQL captured` |
| SQL 有但 PostGIS 失败 | **runtime** / **syntax** / … | `classifySqlError(执行错误)` |
| SQL 执行成功但结果错 | Layer B fail | `execution_pass_final=true`, `result_match=false` |

后续改 harness 时，宜将 **无 SQL** 从 `routing` 改为独立桶（如 `no_sql`），避免与「路由失败」混淆。

---

## 3. 总体表现（72 题）

| 指标 | 数值 |
|------|------|
| **Layer A EPR（final）** | **70.8%**（51/72） |
| **Layer B 结果准确率** | **47.2%**（34/72） |
| **repair_gain** | **0** |
| **Harness `routing` 桶** | **21**（均为无最终 SQL，且均已进 spatial_sql） |

### 3.1 分库

| 数据集 | n | EPR final | Layer B | harness `routing` 桶 |
|--------|---|-----------|---------|----------------------|
| manningham_trees | 24 | **83.3%** | **58.3%** (14/24) | 4 |
| land_zones | 24 | 66.7% | 50.0% (12/24) | 8 |
| road_segment | 24 | 62.5% | 33.3% (8/24) | 9 |

### 3.2 分题型（Layer B，跨库）

| ExecutionTargetPattern | B 通过 | 备注 |
|------------------------|--------|------|
| FILTER_COUNT | 19/29 (66%) | 最稳 |
| SPATIAL_FILTER | 5/8 (63%) | road 阈值类 |
| AGGREGATE_GROUP_BY | 5/10 (50%) | |
| MIXED | 2/5 (40%) | |
| MEASUREMENT | 3/14 (21%) | 常能执行但结果错 |
| LIST_ROWS | **0/5 (0%)** | 多能执行，列/排序/误 GROUP BY |
| SPATIAL_NEAREST | 0/1 (0%) | trees-022，SQL 畸形 |

### 3.3 分难度（Layer B）

| 库 | L1 | L2 | L3 |
|----|----|----|-----|
| trees | 7/8 | 6/10 | 1/6 |
| zones | 6/7 | 3/10 | 3/7 |
| road | 2/4 | 5/13 | 1/7 |

---

## 4. 主要失败结构（OpenAI 本跑）

### 4.1 无最终 SQL（21 题，harness 称 `routing`）

**land_zones**：006, 007, 008, 009, 017, 019, 022, 024  
**manningham_trees**：004, 013, 016, 019  
**road_segment**：003, 008, 015, 016, 017, 018, 021, 022, 024  

常见原因：spatial contract 与 planner 输出冲突、task-spec 与题意不符后 planner 过短结束、rewrite 未产出可捕获 SQL。

### 4.2 有 SQL 但 Layer B 失败（约 17 题）

- **LIST_ROWS**：列集 / ORDER / 误加 GROUP BY + COUNT  
- **MEASUREMENT（尤其 road）**：Length / Area / Perimeter 混用，或标量 vs 行集  
- **FILTER / GROUP**：错列（如 `zone_meani` vs `dev_catego`）、过滤字面量错误  

### 4.3 与本地 WebLLM 三库联跑（若对比）

本报告为 **OpenAI API**；不宜与「日志同样写 WebLLM」的本地跑混淆。OpenAI 在 **routing 桶（无 SQL）** 与 **LIST_ROWS / MEASUREMENT** 上未必优于本地，需以同配置复跑对比。

---

## 5. 结论（可写入终稿摘要）

1. **配置**：评测使用 **OpenAI Chat Completions（默认 gpt-4o-mini）+ 完整 AgentChain spatial_sql 管线**，非浏览器 8B。  
2. **成绩**：72 题 macro **EPR 70.8% / Layer B 47.2%**；trees 最好，road 最弱。  
3. **指标解读**：当前 JSON 的 **`routing` = 未捕获最终 SQL**，**不是**未进 spatial；本跑 21 题全部曾进入 `spatial_sql`。  
4. **改进方向**：与模型无关地优先修 **contract / capture**（避免有 plan 无 SQL）、**LIST_ROWS 模板**、**MEASUREMENT 算子选择**；并修正 harness 错误桶命名以便跨数据集汇报。

---

## 6. 复现说明

1. `magda/magda-web-client`：`yarn sync-magda-eval`  
2. 配置 `REACT_APP_OPENAI_API_KEY`（或评测页填写）  
3. 打开 `/geosql-eval` → LLM backend 选 **OpenAI API** → **Run all 3**  
4. 下载 JSON 报告（本地 `eval_report/`，已 gitignore）
