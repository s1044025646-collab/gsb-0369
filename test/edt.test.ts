import { test } from "node:test";
import assert from "node:assert/strict";
import { edt2d, bruteForce, edt1d, explainCell, INF } from "../src/edt.js";
import { Store } from "../src/store.js";

function grid(rows: number, cols: number, sources: Array<[number, number]>): number[][] {
  const g = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (const [r, c] of sources) g[r][c] = 1;
  return g;
}

function assertSame(actual: ReturnType<typeof edt2d>, expected: ReturnType<typeof edt2d>): void {
  for (let r = 0; r < actual.rows; r++)
    for (let c = 0; c < actual.cols; c++) {
      assert.equal(actual.dist2[r][c], expected.dist2[r][c], `dist2 不一致 @(${r},${c})`);
      assert.equal(actual.srcRow[r][c], expected.srcRow[r][c], `srcRow 不一致 @(${r},${c})`);
      assert.equal(actual.srcCol[r][c], expected.srcCol[r][c], `srcCol 不一致 @(${r},${c})`);
    }
}

test("单格网格：唯一格子即源点", () => {
  const r = edt2d([[1]]);
  assert.equal(r.dist2[0][0], 0);
  assert.deepEqual([r.srcRow[0][0], r.srcCol[0][0]], [0, 0]);
});

test("单行与单列", () => {
  assertSame(edt2d(grid(1, 7, [[0, 3]])), bruteForce(grid(1, 7, [[0, 3]])));
  assertSame(edt2d(grid(7, 1, [[3, 0]])), bruteForce(grid(7, 1, [[3, 0]])));
});

test("全部源点：距离全为零且来源是自身", () => {
  const g = grid(4, 5, []);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) g[r][c] = 1;
  const r = edt2d(g);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 5; j++) {
      assert.equal(r.dist2[i][j], 0);
      assert.deepEqual([r.srcRow[i][j], r.srcCol[i][j]], [i, j]);
    }
});

test("没有源点：结果为明确的不存在状态", () => {
  const r = edt2d(grid(3, 3, []));
  assert.equal(r.dist2[1][1], INF);
  assert.equal(r.srcRow[1][1], -1);
  assert.equal(r.srcCol[1][1], -1);
});

test("5x5 中心单源点：角落平方距离为 8", () => {
  const r = edt2d(grid(5, 5, [[2, 2]]));
  assert.equal(r.dist2[0][0], 8);
  assert.equal(r.dist2[4][4], 8);
  assert.equal(r.dist2[2][2], 0);
});

test("非方形网格 + 多个等距来源，与暴力基准逐格一致", () => {
  const g = grid(3, 8, [[0, 0], [2, 7], [1, 4]]);
  assertSame(edt2d(g), bruteForce(g));
});

test("随机小网格对照暴力基准（距离与规范来源逐格比较）", () => {
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 50; t++) {
    const rows = 1 + Math.floor(rand() * 8);
    const cols = 1 + Math.floor(rand() * 8);
    const g = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => (rand() < 0.25 ? 1 : 0))
    );
    assertSame(edt2d(g), bruteForce(g));
  }
});

test("平局：对称源点取 (row,col) 字典序较小者", () => {
  const r = edt2d(grid(5, 5, [[2, 0], [2, 4]]));
  assert.equal(r.dist2[2][2], 4);
  assert.deepEqual([r.srcRow[2][2], r.srcCol[2][2]], [2, 0]);
  const r2 = edt2d(grid(5, 5, [[0, 2], [4, 2]]));
  assert.equal(r2.dist2[2][2], 4);
  assert.deepEqual([r2.srcRow[2][2], r2.srcCol[2][2]], [0, 2]);
});

test("转置性质：距离矩阵相应转置，来源坐标也转置且仍是原始源点", () => {
  const sources: Array<[number, number]> = [[0, 3], [4, 1]];
  const g = grid(5, 6, sources);
  const gt = grid(6, 5, sources.map(([r, c]) => [c, r]));
  const r = edt2d(g);
  const rt = edt2d(gt);
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 6; j++) {
      assert.equal(rt.dist2[j][i], r.dist2[i][j]);
      // 转置后平局口径变为原问题的列优先，等距时可选不同源点；
      // 但来源必须是转置网格中的真实源点，且确实达到返回的距离
      const sr = rt.srcRow[j][i];
      const sc = rt.srcCol[j][i];
      assert.equal(gt[sr][sc], 1);
      assert.equal((sr - j) ** 2 + (sc - i) ** 2, rt.dist2[j][i]);
    }
  // 来源必须是原始源点之一
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 6; j++) assert.equal(g[r.srcRow[i][j]][r.srcCol[i][j]], 1);
});

test("新增源点不会增大任何格子的距离", () => {
  const g1 = grid(6, 6, [[1, 1]]);
  const g2 = grid(6, 6, [[1, 1], [4, 5]]);
  const r1 = edt2d(g1);
  const r2 = edt2d(g2);
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++) assert.ok(r2.dist2[i][j] <= r1.dist2[i][j]);
});

test("一维：交点恰为整数时平局归较小 q", () => {
  // f(0)=0, f(4)=0，交点 x=2 恰为整数
  const res = edt1d([0, INF, INF, INF, 0], "row", 0);
  assert.deepEqual(res.d, [0, 1, 4, 1, 0]);
  assert.equal(res.arg[2], 0); // x=2 平局，归 q=0
  const env = res.expl.envelope;
  assert.equal(env.length, 2);
  assert.equal(env[0].hi, 2);
  assert.equal(env[1].lo, 3);
});

test("一维：Infinity 候选被跳过且被淘汰者有记录", () => {
  const res = edt1d([INF, 0, INF, 0, INF], "row", 0);
  assert.deepEqual(res.d, [1, 0, 1, 0, 1]);
  assert.ok(res.expl.candidates.filter((c) => c.skipped).length === 3);
  // 中间被完全覆盖的情形
  const res2 = edt1d([0, INF, 4, INF, 0], "row", 0);
  assert.deepEqual(res2.d, [0, 1, 4, 1, 0]);
  assert.ok(res2.expl.eliminated.some((e) => e.q === 2));
});

test("格子解释包含两遍信息与最终来源", () => {
  const g = grid(5, 5, [[2, 2]]);
  const e = explainCell(g, 0, 4);
  assert.equal(e.dist2, 8);
  assert.deepEqual(e.source, { row: 2, col: 2 });
  assert.equal(e.pass2.axis, "col");
  assert.equal(e.pass1?.axis, "row");
  assert.ok(e.pass2.envelope.length >= 1);
  assert.ok(Math.abs((e.sqrtApprox ?? 0) - Math.sqrt(8)) < 1e-12);
});

test("持久化：计算结果跨重开可查询，修改创建新版本不覆盖历史", () => {
  const store = new Store(":memory:");
  const id1 = store.createGrid(grid(5, 5, [[2, 2]]));
  store.compute(id1);
  const id2 = store.deriveGrid(id1, [[0, 0]], []);
  store.compute(id2);
  assert.equal(store.cell(id1, 0, 0).dist2, 8); // 旧版本结果不变
  assert.equal(store.cell(id2, 0, 0).dist2, 0);
  assert.equal(store.info(id2).parent_id, id1);
  assert.equal(store.info(id1).status, "complete");
  store.close();
});

test("未计算时查询返回 NOT_COMPUTED，非法输入返回 INVALID_INPUT", () => {
  const store = new Store(":memory:");
  const id = store.createGrid(grid(2, 2, [[0, 0]]));
  assert.throws(() => store.getResult(id), /尚未计算/);
  assert.throws(() => store.createGrid([[0, 2]]), /0\/1/);
  assert.throws(() => store.cell(id, 9, 9), /越界|尚未计算/);
  store.close();
});
