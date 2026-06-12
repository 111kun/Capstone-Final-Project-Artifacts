# report_final 分层产物说明（报告写作）

评测 JSON 通常放在仓库根目录 **`eval_report/report_final/`**（该目录在 `.gitignore` 中，不随 git 提交）。

## 一键生成

```bash
node magda-eval/scripts/summarize-report-final.mjs
```

## 产出文件

| 文件 | 用途 |
|------|------|
| `comparison-by-run.csv` | 六次运行总表（pipeline、Layer B、token、耗时） |
| `comparison-by-family.csv` | 按能力族（A_计数 … G_复合）横向对比 |
| `comparison-case-matrix.csv` | 72 题 × 各 run pass/fail |
| `comparison-matrix.json` | 机器可读汇总 |
| `<report>-hierarchy-summary.json` | 单次运行分层树 + per_case |
| `<report>-hierarchy.csv` / `-cases.csv` | 展平 rollup / 逐题 |

分层 taxonomy 见 `scripts/caseHierarchy.mjs`。

## 六次 run_id（写作对照）

| run_id | 说明 |
|--------|------|
| `baseline_openai` | baseline_direct + OpenAI（参考上界 ~69%） |
| `baseline_webllm` | baseline + WebLLM（不稳定，勿作主表） |
| `agent_det_webllm` | **生产默认**：agent + 确定性（~68%，7 次 LLM） |
| `agent_det_openai` | agent + 确定性 + OpenAI |
| `agent_planner_webllm` | 消融：全 Planner（~54%） |
| `agent_planner_openai` | 消融：全 Planner + OpenAI |

更完整的表格与分族数据在本地 `eval_report/report_final/README.md`（运行脚本后生成）。
