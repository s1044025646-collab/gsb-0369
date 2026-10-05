import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../db.js";
import { DistanceService } from "../service.js";
import { bruteForceReference, computeDistanceTransform, explainCell } from "../distance.js";
import { indexAt, type BinaryGrid } from "../types.js";
import { validateGrid } from "../validation.js";

function grid(rows: number[][]): BinaryGrid {
  return validateGrid(rows);
}

const cases: BinaryGrid[] = [
  [[0]],
  [[1]],
  [[0, 1, 0, 1]],
  [[0], [1], [0], [1]],
  [[1, 1], [1, 1]],
  [[0, 0], [0, 0]],
  [[0, 0, 1], [1, 0, 0], [0, 0, 0], [0, 1, 0]],
  [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
  [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 1, 1, 1, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]
].map(grid);

for (const testGrid of cases) {
  test(`线性算法匹配逐格枚举 ${testGrid.rows}x${testGrid.cols}`, () => {
    const actual = computeDistanceTransform(testGrid);
    const expected = bruteForceReference(testGrid);
    assert.deepEqual(actual.distances, expected.distances);
    assert.deepEqual(actual.sourceRows, expected.sourceRows);
    assert.deepEqual(actual.sourceCols, expected.sourceCols);

    for (let idx = 0; idx < actual.distances.length; idx += 1) {
      const distance = actual.distances[idx];
      const sourceRow = actual.sourceRows[idx];
      const sourceCol = actual.sourceCols[idx];
      if (distance === null) {
        assert.equal(sourceRow, null);
        assert.equal(sourceCol, null);
      } else {
        const row = Math.floor(idx / testGrid.cols);
        const col = idx % testGrid.cols;
        assert.equal((row - sourceRow!) ** 2 + (col - sourceCol!) ** 2, distance);
      }
    }
  });
}

test("中心单源点角落平方距离精确为 8", () => {
  const actual = computeDistanceTransform(cases[7] as BinaryGrid);
  for (const idx of [0, 4, 20, 24]) assert.equal(actual.distances[idx], 8);
});

test("平局按源点行号再列号选择", () => {
  const tie = grid([
    [1, 0, 0],
    [0, 0, 0],
    [0, 0, 1]
  ]);
  const result = computeDistanceTransform(tie);
  assert.deepEqual([result.sourceRows[4], result.sourceCols[4]], [0, 0]);
});

test("转置后距离转置且来源仍指向原始源点", () => {
  const original = grid([
    [1, 0, 0, 0],
    [0, 0, 0, 1],
    [0, 0, 1, 0]
  ]);
  const transposed = grid([
    [1, 0, 0],
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 0]
  ]);
  const a = computeDistanceTransform(original);
  const b = computeDistanceTransform(transposed);
  for (let row = 0; row < original.rows; row += 1) {
    for (let col = 0; col < original.cols; col += 1) {
      assert.equal(a.distances[indexAt(row, col, original.cols)], b.distances[indexAt(col, row, transposed.cols)]);
    }
  }
  assert.ok(transposed.cells[indexAt(b.sourceRows[7]!, b.sourceCols[7]!, transposed.cols)] === 1);
});

test("新增源点不会增大任何距离", () => {
  const beforeGrid = grid([
    [1, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ]);
  const afterGrid = grid([
    [1, 0, 0],
    [0, 0, 0],
    [0, 0, 1]
  ]);
  const before = computeDistanceTransform(beforeGrid);
  const after = computeDistanceTransform(afterGrid);
  for (let idx = 0; idx < before.distances.length; idx += 1) {
    assert.ok(after.distances[idx]! <= before.distances[idx]!);
  }
});

test("多批随机网格逐格对拍距离和规范来源", () => {
  for (let seed = 1; seed <= 80; seed += 1) {
    let state = seed * 9301 + 49297;
    const random = () => {
      state = (state * 9301 + 49297) % 233280;
      return state / 233280;
    };
    const rows = 1 + Math.floor(random() * 12);
    const cols = 1 + Math.floor(random() * 17);
    const cells: number[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => (random() < 0.32 ? 1 : 0))
    );
    const randomGrid = grid(cells);
    assert.deepEqual(computeDistanceTransform(randomGrid), bruteForceReference(randomGrid));
  }
});

test("解释包含计算范围、候选、淘汰和边界", () => {
  const explanation = explainCell(cases[7] as BinaryGrid, 2, 2);
  assert.equal(explanation.firstPass, "columns-from-top-to-bottom");
  assert.equal(explanation.vertical.candidates.length, 5);
  assert.ok(explanation.vertical.activeIntervals.length === 1);
  assert.ok(explanation.horizontal.activeIntervals.length === 1);
  assert.equal(explanation.finalDistanceSquared, 0);
});

test("全零网格使用不存在状态", () => {
  const result = computeDistanceTransform(grid([[0, 0], [0, 0]]));
  assert.deepEqual(result.distances, [null, null, null, null]);
  assert.equal(result.hasAnySource, false);
});
