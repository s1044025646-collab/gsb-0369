// SQLite 持久化（Node 内置 node:sqlite，零外部依赖）。
// 保存原始网格、算法版本与完整结果；修改输入只新增版本，不覆盖历史。
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { edt2d, validateGrid, type GridResult } from "./edt.js";

export const ALGO_VERSION = "separable-edt-v1";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

interface GridRow {
  id: number;
  rows: number;
  cols: number;
  data: string;
  parent_id: number | null;
  algo_version: string | null;
  status: string;
  created_at: string;
  computed_at: string | null;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS grids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rows INTEGER NOT NULL,
        cols INTEGER NOT NULL,
        data TEXT NOT NULL,
        parent_id INTEGER,
        algo_version TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        computed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS results (
        grid_id INTEGER PRIMARY KEY REFERENCES grids(id),
        dist2 TEXT NOT NULL,
        src_row TEXT NOT NULL,
        src_col TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  private getRow(id: number): GridRow {
    const row = this.db.prepare("SELECT * FROM grids WHERE id = ?").get(id) as GridRow | undefined;
    if (!row) throw new ApiError("NOT_FOUND", `网格 ${id} 不存在`, 404);
    return row;
  }

  getGrid(id: number): { rows: number; cols: number; data: number[][] } {
    const row = this.getRow(id);
    return { rows: row.rows, cols: row.cols, data: JSON.parse(row.data) };
  }

  info(id: number): Omit<GridRow, "data"> {
    const { data, ...rest } = this.getRow(id);
    return rest;
  }

  list(): Array<Omit<GridRow, "data">> {
    const rows = this.db
      .prepare("SELECT * FROM grids ORDER BY id")
      .all() as unknown as GridRow[];
    return rows.map(({ data, ...rest }) => rest);
  }

  createGrid(data: number[][], parentId: number | null = null): number {
    const rows = data.length;
    const cols = data[0]?.length ?? 0;
    const err = validateGrid(rows, cols, data);
    if (err) throw new ApiError("INVALID_INPUT", err);
    const r = this.db
      .prepare("INSERT INTO grids (rows, cols, data, parent_id) VALUES (?, ?, ?, ?)")
      .run(rows, cols, JSON.stringify(data), parentId);
    return Number(r.lastInsertRowid);
  }

  // 添加/移除源点并创建新版本（不修改旧版本）
  deriveGrid(id: number, add: Array<[number, number]>, remove: Array<[number, number]>): number {
    const { rows, cols, data } = this.getGrid(id);
    const next = data.map((r) => [...r]);
    const check = (r: number, c: number) => {
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= rows || c >= cols)
        throw new ApiError("INVALID_INPUT", `坐标 (${r},${c}) 越界`);
    };
    for (const [r, c] of remove) {
      check(r, c);
      next[r][c] = 0;
    }
    for (const [r, c] of add) {
      check(r, c);
      next[r][c] = 1;
    }
    return this.createGrid(next, id);
  }

  // 完整重算；失败不会写入 complete 状态
  compute(id: number): GridResult {
    const { data } = this.getGrid(id);
    const result = edt2d(data); // 抛错则状态保持 pending
    this.db
      .prepare(
        "INSERT OR REPLACE INTO results (grid_id, dist2, src_row, src_col) VALUES (?, ?, ?, ?)"
      )
      .run(
        id,
        JSON.stringify(result.dist2),
        JSON.stringify(result.srcRow),
        JSON.stringify(result.srcCol)
      );
    this.db
      .prepare("UPDATE grids SET algo_version = ?, status = 'complete', computed_at = datetime('now') WHERE id = ?")
      .run(ALGO_VERSION, id);
    return result;
  }

  getResult(id: number): GridResult {
    const row = this.getRow(id);
    if (row.status !== "complete")
      throw new ApiError("NOT_COMPUTED", `网格 ${id} 尚未计算，请先调用 compute`, 409);
    const res = this.db
      .prepare("SELECT * FROM results WHERE grid_id = ?")
      .get(id) as { dist2: string; src_row: string; src_col: string };
    return {
      rows: row.rows,
      cols: row.cols,
      dist2: JSON.parse(res.dist2),
      srcRow: JSON.parse(res.src_row),
      srcCol: JSON.parse(res.src_col),
    };
  }

  cell(id: number, r: number, c: number) {
    const result = this.getResult(id);
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= result.rows || c >= result.cols)
      throw new ApiError("INVALID_INPUT", `坐标 (${r},${c}) 越界`);
    const d = result.dist2[r][c];
    const sr = result.srcRow[r][c];
    return {
      row: r,
      col: c,
      dist2: Number.isFinite(d) ? d : null,
      sqrtApprox: Number.isFinite(d) ? Math.sqrt(d) : null,
      source: sr >= 0 ? { row: sr, col: result.srcCol[r][c] } : null,
    };
  }
}
