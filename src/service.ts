import { Storage } from "./db.js";
import { computeDistanceTransform, explainCell } from "./distance.js";
import { indexAt, type BinaryGrid, type CellExplanation, type DistanceResult } from "./types.js";
import { validateCoordinate, ValidationError } from "./validation.js";

export class DistanceService {
  constructor(private readonly storage: Storage) {}

  importGrid(grid: BinaryGrid, name = `grid-${new Date().toISOString()}`) {
    return this.storage.importGrid(grid, name);
  }

  getGrid(gridId: number) {
    const grid = this.storage.getGrid(gridId);
    if (!grid) throw new ValidationError("GRID_NOT_FOUND", `网格 ${gridId} 不存在`);
    return grid;
  }

  listVersions(gridId: number) {
    this.getGrid(gridId);
    return this.storage.listVersions(gridId);
  }

  requireVersion(versionId: number) {
    const record = this.storage.getVersionWithGrid(versionId);
    if (!record) throw new ValidationError("VERSION_NOT_FOUND", `版本 ${versionId} 不存在`);
    return record;
  }

  versionGrid(versionId: number): BinaryGrid {
    const record = this.requireVersion(versionId);
    return {
      rows: record.grid.rows,
      cols: record.grid.cols,
      cells: record.version.cells
    };
  }

  compute(versionId: number): DistanceResult & { versionId: number; complete: true } {
    const grid = this.versionGrid(versionId);
    const result = computeDistanceTransform(grid);
    this.storage.saveResult(versionId, result);
    return { ...result, versionId, complete: true };
  }

  private ensureResult(versionId: number) {
    const stored = this.storage.getResult(versionId);
    if (stored) return stored;
    return this.compute(versionId);
  }

  query(versionId: number, rowInput: unknown, colInput: unknown) {
    const grid = this.versionGrid(versionId);
    const row = validateCoordinate("row", rowInput, grid.rows);
    const col = validateCoordinate("col", colInput, grid.cols);
    const result = this.ensureResult(versionId);
    const idx = indexAt(row, col, grid.cols);
    const distanceSquared = result.distances[idx];
    return {
      row,
      col,
      distanceSquared,
      sourceRow: result.sourceRows[idx],
      sourceCol: result.sourceCols[idx],
      exists: distanceSquared !== null,
      squareRootApproximation: distanceSquared === null ? null : Math.sqrt(distanceSquared)
    };
  }

  explain(versionId: number, rowInput: unknown, colInput: unknown): CellExplanation {
    const grid = this.versionGrid(versionId);
    const row = validateCoordinate("row", rowInput, grid.rows);
    const col = validateCoordinate("col", colInput, grid.cols);
    return explainCell(grid, row, col);
  }

  modifySource(
    gridId: number,
    rowInput: unknown,
    colInput: unknown,
    enabled: 0 | 1,
    label: string
  ): { versionId: number; gridId: number } {
    const grid = this.getGrid(gridId);
    const row = validateCoordinate("row", rowInput, grid.rows);
    const col = validateCoordinate("col", colInput, grid.cols);
    const versions = this.storage.listVersions(gridId);
    const latestCells = versions.at(-1)?.cells ?? grid.cells;
    const cells = [...latestCells];
    cells[indexAt(row, col, grid.cols)] = enabled;
    const versionId = this.storage.createChangedVersion(gridId, cells, label);
    return { gridId, versionId };
  }

  exportMatrices(versionId: number) {
    const grid = this.versionGrid(versionId);
    const result = this.ensureResult(versionId);
    return {
      grid: this.toMatrix(grid.cells, grid.rows, grid.cols),
      distanceSquared: this.toMatrix(result.distances, grid.rows, grid.cols),
      sourceRow: this.toMatrix(result.sourceRows, grid.rows, grid.cols),
      sourceCol: this.toMatrix(result.sourceCols, grid.rows, grid.cols)
    };
  }

  private toMatrix(values: Array<number | null>, rows: number, cols: number): Array<Array<number | null>> {
    const output: Array<Array<number | null>> = [];
    for (let row = 0; row < rows; row += 1) {
      output.push(values.slice(row * cols, row * cols + cols));
    }
    return output;
  }
}
