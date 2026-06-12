# 三库评测 schema 速查（Console / gold_sql 实测）

表名固定为 **`features`**（`id`, `properties` JSONB, `geom` SRID 4326）。业务字段仅通过 `properties->>'key'` 访问。

## land_zones（24 题）

| 常用 key | 说明 |
|----------|------|
| `zone` | 区划代码（MOSS, R, LCe, C…） |
| `dev_catego` | 开发类别（OPEN SPACE, RESIDENTIAL, COMMERCIAL…） |
| `devplan_co` | 发展规划代码（PLAY…） |
| `zone_meani` | 区划含义文本（ILIKE 检索） |
| `shape_Area`, `shape_Leng` | 属性中的面积/长度（字符串，聚合需 `::double precision`） |
| `precinct`, `policy`, `policy_mea`, `special_us`, `urban_cent` | 其他规划属性 |

几何：面；量算可用 `ST_Area(geom::geography)`（平方米）。

## manningham_trees（24 题）

| 常用 key | 说明 |
|----------|------|
| `suburb`, `street`, `str_type` | 区位与街道 |
| `species` | 树种 |
| `treearea` | 管护片区（Area 6…） |
| `height`, `dbh` | **字符串标签**（如 `15+m`、`500 - 1000mm`），勿 `::numeric` |
| `pcode`, `house`, `lat`, `lon` | 邮编、门牌、坐标 |
| `alphatree`, `date1` | 其他 |

几何：点；最近邻题用 `King` + `Str` 作参考，`ST_Distance(…::geography)` 为米。

## road_segment（24 题）

| 常用 key | 说明 |
|----------|------|
| `name` | 多为 `ROAD_SEGMENT` |
| `Region`, `visibility`, `open`, `address`, `description` 等 | 属性几乎同质 |

几何：**MultiPolygon**（非线）；周长用 **`ST_Perimeter(geom::geography)`**，长度/距离类口语仍可能对应 perimeter 边界；`ST_Length` 在 001–010 槽位保留。有效性：`ST_IsValid(geom)`。

## 题型矩阵（每库 24）

与 `README.md` 一致：`FILTER_COUNT` / `AGGREGATE_GROUP_BY` / `LIST_ROWS` / `MEASUREMENT` / `SPATIAL_FILTER` / `SPATIAL_NEAREST`（仅 trees）/ `MIXED`，难度 `L1`–`L3`，结果 `scalar` | `rows`。

问题表述已改为自然口语（避免 geodesic、PostGIS 术语堆砌）；`gold_sql` 仍为可执行基准。
