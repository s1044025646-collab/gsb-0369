import { MAX_DIMENSION, type BinaryGrid } from "./types.js";

export class ValidationError extends Error {
  code: string;
  details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.details = details;
  }
}

export function validateGrid(input: unknown): BinaryGrid {
  if (!Array.isArray(input)) {
    throw new ValidationError("GRID_NOT_MATRIX", "网格必须是二维零一数组");
  }
  if (input.length === 0) {
    throw new ValidationError("GRID_EMPTY", "网格至少需要一行");
  }
  if (input.length > MAX_DIMENSION) {
    throw new ValidationError("GRID_TOO_MANY_ROWS", `行数不能超过 ${MAX_DIMENSION}`);
  }

  const rows = input.length;
  const cols = input[0] === null || input[0] === undefined ? 0 : input[0].length;
  if (!Number.isInteger(cols) || cols === 0) {
    throw new ValidationError("GRID_EMPTY_ROW", "每一行必须是非空数组");
  }
  if (cols > MAX_DIMENSION) {
    throw new ValidationError("GRID_TOO_MANY_COLS", `列数不能超过 ${MAX_DIMENSION}`);
  }

  const cells: number[] = new Array(rows * cols);
  for (let row = 0; row < rows; row += 1) {
    if (!Array.isArray(input[row]) || input[row].length !== cols) {
      throw new ValidationError("GRID_NOT_RECTANGULAR", "网格必须是矩形，所有行长度一致", {
        row,
        expectedCols: cols
      });
    }
    for (let col = 0; col < cols; col += 1) {
      const value = input[row][col];
      if (value !== 0 && value !== 1) {
        throw new ValidationError("GRID_INVALID_CELL", "格子只能是 0 或 1", { row, col, value });
      }
      cells[row * cols + col] = value;
    }
  }
  return { rows, cols, cells };
}

export function validateCoordinate(name: string, value: unknown, maxExclusive: number): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= maxExclusive) {
    throw new ValidationError(
      "INVALID_COORDINATE",
      `${name} 必须位于 [0, ${maxExclusive - 1}] 的整数范围内`,
      { field: name, value }
    );
  }
  return value as number;
}

export function parseGridFromRows(rows: string[]): BinaryGrid {
  try {
    const parsed = rows.map((row) => JSON.parse(row));
    return validateGrid(parsed);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("GRID_PARSE_FAILED", "无法解析网格；每行应为如 [0,1,0] 的 JSON 数组");
  }
}
