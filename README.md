# 二值网格精确平方欧氏距离变换

这是一个只包含 API 与 CLI 的 Windows 本地后端，使用 TypeScript、Node.js 和项目数据目录中的 SQLite。输入矩形二维零一矩阵，`1` 表示源点；每个格子查询到最近源点中心的平方欧氏距离：

```text
d²(r,c) = min((r-r0)² + (c-c0)²)
```

行列坐标均从 0 开始，单位间距固定为 1，边界不循环。输出是精确整数平方距离和一个达到该距离的源点。平方根仅用于展示，不参与最近源点或平局选择。距离相同时，按源点行号、再按源点列号选择较小者。

## 算法

实现的是可分离的 Felzenszwalb/Huttenlocher 风格平方距离下包络算法，但自己维护抛物线候选与整数分界：

1. 第一遍逐列处理，沿行方向计算每个格子到该列源点的一维平方距离及来源。
2. 第二遍逐行处理，沿列方向合并第一遍结果。
3. 一维问题为 `min_q(f(q)+(x-q)^2)`，候选交点表示为整数分子分母，跳过 `null` 无穷代价，不让 `Infinity` 与普通数混算。
4. 总时间复杂度为 `O(rows × cols)`，不调用图像库，也不把逐格枚举作为正式算法。

注意：先列后行，不转置网格，因此非方形网格不会行列错位。测试中使用独立逐格枚举作为基准。

全零网格没有源点，结果为：

```json
{ "distanceSquared": null, "sourceRow": null, "sourceCol": null, "exists": false }
```

每边最大长度为 512。展示范围限制不改变计算范围；解释会重建该格所在列与行的完整候选序列，而不是只处理邻近部分。

## 构建、测试、启动、演示

```powershell
npm install
npm run build
npm test
npm run demo
$env:PORT="3000"; npm start
```

不设置 `PORT` 时自动选择本机空闲端口。默认 SQLite 路径为项目内 `data/edt.sqlite`，可通过以下变量修改：

```powershell
$env:EDT_DB_PATH="E:\GSB\0369\B\data\custom.sqlite"
```

需要 Node.js 22.5 或更高版本；本项目使用 Node 内置的 `node:sqlite`，不需要 Docker、WSL、原生编译工具链或外部在线服务。

## CLI

```powershell
node dist/cli.js import --name sample --row 1,0,0 --row 0,0,0
node dist/cli.js compute --version 1
node dist/cli.js query --version 1 --row 1 --col 2
node dist/cli.js explain --version 1 --row 1 --col 2
node dist/cli.js add-source --grid 1 --row 1 --col 2
node dist/cli.js remove-source --grid 1 --row 0 --col 0
node dist/cli.js export --version 2 --out data/result.json
node dist/cli.js demo
```

`demo` 创建两个五乘五网格：中心单源点和中轴三个对称源点。单源点网格四个角的平方距离均为 `8`；对称网格会展示平局以及较小行列坐标源点的选择。

## HTTP API

- `GET /health`：健康检查和算法版本。
- `POST /grids`：请求体 `{ "name": "x", "grid": [[0,1]] }`。
- `GET /grids/:gridId/versions`：查看版本。
- `POST /versions/:versionId/compute`：完整重算并保存结果。
- `GET /versions/:versionId/cell?row=0&col=0`：查询距离、来源和平方根近似值。
- `GET /versions/:versionId/explain?row=0&col=0`：查看两遍一维候选、淘汰原因、整数/实数生效边界和最终来源。
- `POST /grids/:gridId/sources`：请求体 `{ "row": 1, "col": 2, "enabled": 1 }`，创建新版本。
- `GET /versions/:versionId/export`：导出网格、平方距离、来源行和来源列矩阵。

错误响应统一为：

```json
{ "error": { "code": "VALIDATION_CODE", "message": "中文说明", "details": {} } }
```

常见错误码包括 `GRID_NOT_MATRIX`、`GRID_NOT_RECTANGULAR`、`GRID_INVALID_CELL`、`GRID_TOO_MANY_ROWS`、`GRID_TOO_MANY_COLS`、`INVALID_COORDINATE`、`VERSION_NOT_FOUND`、`INVALID_JSON`。

## 持久化与重启

SQLite 保存原始网格、版本输入、算法版本、完整索引状态、平方距离与来源矩阵。添加或移除源点只会创建新版本，不覆盖历史报告。版本只有完整计算成功后才标记为 `complete = 1`；进程中断不会产生伪完整状态。重启后重新打开数据库即可查询已完成版本，未完成版本可重新请求计算。

## 限制

- 只处理矩形离散二值网格，不处理经纬度、图片识别、连续平面多边形或障碍路径距离。
- 输出距离不是四邻接 Manhattan 步数，也不是棋王 Chebyshev 步数。
- 没有网页和鉴权层，只监听 `127.0.0.1`，面向本地工具使用。
- 修改输入后完整重算，未实现增量动态更新。
