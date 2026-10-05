# 二值网格精确欧氏距离变换后端

TypeScript + Node.js + SQLite 实现的二值网格**精确平方欧氏距离变换（EDT）**与最近源点解释后端，仅提供 API 与 CLI，Windows 本地运行，零外部运行时依赖（SQLite 与 HTTP 均使用 Node 内置模块）。

## 问题定义

- 输入：矩形 0/1 网格，`1` 为源点。坐标为整数行列，`row` 向下、`col` 向右，原点 `(0,0)` 在左上，单位间距固定，边界不循环。
- 输出：每个格子到最近源点中心的**最小平方欧氏距离** `dist2 = (dr)^2 + (dc)^2`（精确整数），以及一个达到该距离的源点坐标；平方根仅作展示（`sqrtApprox`），不参与平局判定。
- 平局规则：多个源点等距时按 `(row, col)` 字典序取较小者。一维交点恰为整数时该位置平局，归下标较小的候选，与全局口径一致。
- 全零网格：没有最近源点，`dist2 = null`（内部为 `Infinity`）、`source = null`，而不是任意大数。
- 每维上限 512；最大平方距离 `2 * 511^2`，远在精确整数范围内。

## 算法（线性时间两遍结构）

自行实现的可分离二维变换（Felzenszwalb-Huttenlocher 风格），整体复杂度 O(rows × cols)，不枚举全部源点，不调用任何图像库：

1. **第一遍沿行**：对每一行做一维变换，`f(q) = 0`（源点）或 `Infinity`。一维问题即求 `min_q f(q) + (x - q)^2`：维护真正能成为最小值的抛物线下包络及其生效区间，再扫描整数位置得到结果。`Infinity` 候选明确跳过，绝不与有限值混算交点（避免 NaN）。
2. **第二遍沿列**：对每一列做一维变换，`f(y)` 取第一遍的平方距离。两遍之间传递来源下标（第一遍记录源点列，第二遍记录源点行），保证最终报告的坐标确实达到返回的平方距离。

非方形网格不会错位：第一遍固定行、沿列方向；第二遍固定列、沿行方向，维度始终按原网格索引，不做隐式转置。

## 解释功能

对任意格子或指定行/列给出一维解释：候选列表（含被跳过的 `Infinity` 候选）、被淘汰候选及原因、包络抛物线的交点边界与生效整数区间、最终选中来源。解释的计算范围始终是完整的行/列，`limit` 参数只限制展示条数。

## 构建、测试、启动、演示

```powershell
npm install        # 仅开发依赖 typescript / @types/node
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 API（默认选择空闲端口，--port=8080 或 PORT 环境变量可指定）
npm run demo       # 5x5 演示：中心单源点角落 dist2=8；加入对称源点展示平局
```

CLI 其他命令（数据默认存于项目内 `data/edt.db`，可用 `EDT_DB` 覆盖）：

```powershell
node dist/src/cli.js compute <id>        # 完整重算某版本
node dist/src/cli.js result <id>         # 距离矩阵 + 源点坐标表
node dist/src/cli.js cell <id> <r> <c>   # 单格距离与来源
node dist/src/cli.js explain <id> <r> <c># 单格两遍解释
node dist/src/cli.js export <id>         # 导出数值矩阵（无源点格子为 .）
```

## HTTP API

错误统一为 `{ "error": { "code", "message" } }`，错误码：`INVALID_INPUT`、`NOT_FOUND`、`NOT_COMPUTED`、`INTERNAL`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/grids` | 导入网格：`{data:[[0,1],...]}` 或 `{rows,cols,sources:[[r,c]]}` |
| GET | `/grids` / `/grids/:id` | 列表 / 详情（含算法版本与状态） |
| POST | `/grids/:id/compute` | 完整重算，成功后状态为 `complete` |
| GET | `/grids/:id/result` | 完整距离与来源矩阵 |
| GET | `/grids/:id/cell?r=&c=` | 单格 `dist2`、`sqrtApprox`、`source` |
| GET | `/grids/:id/explain?r=&c=` 或 `?axis=row|col&index=&limit=` | 一维/格子解释 |
| POST | `/grids/:id/sources` | `{add:[[r,c]], remove:[[r,c]]}` 创建新版本，旧版本与历史结果不变 |
| GET | `/grids/:id/export` | 文本数值矩阵 |

## 持久化

SQLite（`node:sqlite`）保存原始网格、算法版本（`separable-edt-v1`）、计算状态与完整结果。修改输入只新增版本，不覆盖历史报告；计算失败不会标记为 `complete`；重启后无需重输网格即可查询。

## 测试

`test/edt.test.ts` 覆盖：单格、单行/单列、全部源点、无源点、非方形、多个等距来源、交点恰为整数的平局、`Infinity` 候选跳过与淘汰记录；并用独立逐格枚举基准对 50 个随机小网格**逐格**比较距离与规范来源；另验证转置后距离相应转置、来源仍是真实源点且达到返回距离、新增源点不增大距离、持久化跨重开可查。

## 限制

- 仅处理整数行列的二值网格，不支持经纬度、图片识别或连续平面多边形。
- 修改为整版重算，不做动态增量更新。
- `node:sqlite` 在 Node 25 仍带 ExperimentalWarning，不影响功能。
- 解释 JSON 中 `-Infinity` 边界序列化为 `null`（表示向左无界）。
