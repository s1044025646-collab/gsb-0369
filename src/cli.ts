// CLI：演示、建库、计算、查询、解释、导出、启动服务。
import path from "node:path";
import { Store } from "./store.js";
import { createServer } from "./server.js";
import { explainCell } from "./edt.js";
const DB_PATH = process.env.EDT_DB ?? path.join(process.cwd(), "data", "edt.db");
function printMatrix(title: string, m: number[][], fmt: (v: number) => string = String): void {
  console.log(title);
  for (const row of m) console.log("  " + row.map((v) => fmt(v).padStart(4)).join(""));
}
function printSources(title: string, r: { srcRow: number[][]; srcCol: number[][] }): void {
  console.log(title);
  for (let i = 0; i < r.srcRow.length; i++)
    console.log("  " + r.srcRow[i].map((sr, c) => (sr < 0 ? "  -,-" : `  ${sr},${r.srcCol[i][c]}`)).join(""));
}
function demo(store: Store): void {
  console.log("== 演示 1：5x5 网格，仅中心 (2,2) 一个源点 ==");
  const g1 = Array.from({ length: 5 }, (_, r) =>
    Array.from({ length: 5 }, (_, c) => (r === 2 && c === 2 ? 1 : 0))
  );
  const id1 = store.createGrid(g1);
  const r1 = store.compute(id1);
  printMatrix("平方距离矩阵（版本 " + id1 + "）：", r1.dist2);
  console.log(`角落 (0,0) 平方距离 = ${r1.dist2[0][0]}（期望 8），sqrt ≈ ${Math.sqrt(8).toFixed(4)}`);
  printSources("最近源点坐标表：", r1);
  console.log("\n== 演示 2：加入对称源点 (2,0) 与 (2,4)，观察平局 ==");
  const id2 = store.deriveGrid(id1, [[2, 0], [2, 4]], []);
  const r2 = store.compute(id2);
  printMatrix("平方距离矩阵（版本 " + id2 + "）：", r2.dist2);
  printSources("最近源点坐标表：", r2);
  const c = store.cell(id2, 2, 1);
  console.log(
    `格子 (2,1)：到 (2,0) 与 (2,2) 等距（dist2=${c.dist2}），平局按 (row,col) 字典序取小 -> 源点 (${c.source?.row},${c.source?.col})`
  );
  console.log("\n== 格子 (0,4) 的解释（截取）==");
  const expl = explainCell(g1, 0, 4);
  console.log(`dist2=${expl.dist2}, source=(${expl.source?.row},${expl.source?.col})`);
  console.log("第二遍（列 4）包络：", JSON.stringify(expl.pass2.envelope));
  console.log(expl.note);
  console.log(`\n数据已保存到 ${DB_PATH}（版本 ${id1}, ${id2}），重启后可直接查询。`);
}
async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const store = new Store(DB_PATH);
  try {
    switch (cmd) {
      case "demo":
        demo(store);
        break;
      case "serve": {
        const portArg = args.find((a) => a.startsWith("--port="));
        const port = portArg ? Number(portArg.split("=")[1]) : Number(process.env.PORT ?? 0);
        const server = createServer(store);
        server.listen(port, () => {
          const addr = server.address();
          console.log(`EDT API listening on http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : port}`);
        });
        return;
      }
      case "compute":
        store.compute(Number(args[0]));
        console.log(`网格 ${args[0]} 计算完成`);
        break;
      case "result": {
        const r = store.getResult(Number(args[0]));
        printMatrix("平方距离矩阵：", r.dist2, (v) => (Number.isFinite(v) ? String(v) : "."));
        printSources("最近源点：", r);
        break;
      }
      case "cell":
        console.log(JSON.stringify(store.cell(Number(args[0]), Number(args[1]), Number(args[2]))));
        break;
      case "explain": {
        const { data } = store.getGrid(Number(args[0]));
        console.log(JSON.stringify(explainCell(data, Number(args[1]), Number(args[2])), null, 2));
        break;
      }
      case "export": {
        const r = store.getResult(Number(args[0]));
        console.log(r.dist2.map((row) => row.map((v) => (Number.isFinite(v) ? v : ".")).join(" ")).join("\n"));
        break;
      }
      default:
        console.log(`用法：
  node dist/src/cli.js demo                 运行 5x5 演示
  node dist/src/cli.js serve [--port=8080]  启动 API（默认空闲端口）
  node dist/src/cli.js compute <id>         计算网格
  node dist/src/cli.js result <id>          查看完整结果
  node dist/src/cli.js cell <id> <r> <c>    查询单格
  node dist/src/cli.js explain <id> <r> <c> 单格解释
  node dist/src/cli.js export <id>          导出数值矩阵`);
    }
  } finally {
    if (process.argv[2] !== "serve") store.close();
  }
}
main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
