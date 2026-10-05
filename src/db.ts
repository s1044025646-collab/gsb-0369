import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ALGORITHM_VERSION, type BinaryGrid, type DistanceResult, indexAt } from "./types.js";

export interface GridRecord {
  id: number;
  name: string;
  rows: number;
  cols: number;
  cells: number[];
  createdAt: string;
}

export interface VersionRecord {
  id: number;
  gridId: number;
  version: number;
  label: string | null;
  cells: number[];
  algorithmVersion: string;
  complete: boolean;
  computedAt: string | null;
  createdAt: string;
}

export interface StoredResult extends DistanceResult {
  versionId: number;
}

export class Storage {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    const absolutePath = resolve(path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    this.db = new DatabaseSync(absolutePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS grids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        rows INTEGER NOT NULL,
        cols INTEGER NOT NULL,
        cells TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        label TEXT,
        cells TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        complete INTEGER NOT NULL DEFAULT 0,
        computed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(grid_id, version)
      );

      CREATE TABLE IF NOT EXISTS cells_result (
        version_id INTEGER PRIMARY KEY REFERENCES versions(id) ON DELETE CASCADE,
        distances TEXT NOT NULL,
        source_rows TEXT NOT NULL,
        source_cols TEXT NOT NULL,
        has_any_source INTEGER NOT NULL
      );
    `);
  }

  withTransaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  importGrid(grid: BinaryGrid, name: string): { gridId: number; versionId: number } {
    const insertGrid = this.db.prepare(
      "INSERT INTO grids (name, rows, cols, cells) VALUES (?, ?, ?, ?)"
    );
    const insertVersion = this.db.prepare(
      `INSERT INTO versions (grid_id, version, label, cells, algorithm_version)
       VALUES (?, 1, 'initial', ?, ?)`
    );

    return this.withTransaction(() => {
      const gridInfo = insertGrid.run(name, grid.rows, grid.cols, JSON.stringify(grid.cells));
      const gridId = Number(gridInfo.lastInsertRowid);
      const versionInfo = insertVersion.run(
        gridId,
        JSON.stringify(grid.cells),
        ALGORITHM_VERSION
      );
      return { gridId, versionId: Number(versionInfo.lastInsertRowid) };
    });
  }

  getGrid(gridId: number): GridRecord | null {
    const row = this.db
      .prepare("SELECT id, name, rows, cols, cells, created_at AS createdAt FROM grids WHERE id = ?")
      .get(gridId) as
      | { id: number; name: string; rows: number; cols: number; cells: string; createdAt: string }
      | undefined;
    return row ? { ...row, cells: JSON.parse(row.cells) as number[] } : null;
  }

  getVersion(versionId: number): VersionRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, grid_id AS gridId, version, label, cells, algorithm_version AS algorithmVersion,
                complete, computed_at AS computedAt, created_at AS createdAt
         FROM versions WHERE id = ?`
      )
      .get(versionId) as
      | {
          id: number;
          gridId: number;
          version: number;
          label: string | null;
          cells: string;
          algorithmVersion: string;
          complete: number;
          computedAt: string | null;
          createdAt: string;
        }
      | undefined;
    if (!row) return null;
    return { ...row, cells: JSON.parse(row.cells), complete: row.complete === 1 };
  }

  listVersions(gridId: number): VersionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, grid_id AS gridId, version, label, cells, algorithm_version AS algorithmVersion,
                complete, computed_at AS computedAt, created_at AS createdAt
         FROM versions WHERE grid_id = ? ORDER BY version`
      )
      .all(gridId) as Array<{
      id: number;
      gridId: number;
      version: number;
      label: string | null;
      cells: string;
      algorithmVersion: string;
      complete: number;
      computedAt: string | null;
      createdAt: string;
    }>;
    return rows.map((row) => ({ ...row, cells: JSON.parse(row.cells), complete: row.complete === 1 }));
  }

  createChangedVersion(gridId: number, cells: number[], label: string): number {
    const grid = this.getGrid(gridId);
    if (!grid) throw new Error("GRID_NOT_FOUND");
    const nextVersion = this.db
      .prepare("SELECT COALESCE(MAX(version), 0) + 1 AS next FROM versions WHERE grid_id = ?")
      .get(gridId) as { next: number };
    const info = this.db
      .prepare(
        `INSERT INTO versions (grid_id, version, label, cells, algorithm_version)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(gridId, nextVersion.next, label, JSON.stringify(cells), ALGORITHM_VERSION);
    return Number(info.lastInsertRowid);
  }

  saveResult(versionId: number, result: DistanceResult): void {
    const replace = this.db.prepare(
      `INSERT OR REPLACE INTO cells_result
         (version_id, distances, source_rows, source_cols, has_any_source)
       VALUES (?, ?, ?, ?, ?)`
    );
    const markComplete = this.db.prepare(
      "UPDATE versions SET complete = 1, computed_at = CURRENT_TIMESTAMP WHERE id = ?"
    );
    this.withTransaction(() => {
      replace.run(
        versionId,
        JSON.stringify(result.distances),
        JSON.stringify(result.sourceRows),
        JSON.stringify(result.sourceCols),
        result.hasAnySource ? 1 : 0
      );
      markComplete.run(versionId);
    });
  }

  getResult(versionId: number): StoredResult | null {
    const version = this.getVersion(versionId);
    if (!version || !version.complete) return null;
    const row = this.db
      .prepare(
        `SELECT r.distances, r.source_rows AS sourceRows, r.source_cols AS sourceCols,
                r.has_any_source AS hasAnySource, g.rows, g.cols
         FROM cells_result r
         JOIN versions v ON v.id = r.version_id
         JOIN grids g ON g.id = v.grid_id
         WHERE r.version_id = ?`
      )
      .get(versionId) as
      | {
          distances: string;
          sourceRows: string;
          sourceCols: string;
          hasAnySource: number;
          rows: number;
          cols: number;
        }
      | undefined;
    if (!row) return null;
    return {
      versionId,
      rows: row.rows,
      cols: row.cols,
      distances: JSON.parse(row.distances),
      sourceRows: JSON.parse(row.sourceRows),
      sourceCols: JSON.parse(row.sourceCols),
      hasAnySource: row.hasAnySource === 1
    };
  }

  getVersionWithGrid(versionId: number): { grid: GridRecord; version: VersionRecord } | null {
    const version = this.getVersion(versionId);
    if (!version) return null;
    const grid = this.getGrid(version.gridId);
    if (!grid) return null;
    return { grid, version };
  }

  matrixFromVersion(version: VersionRecord): BinaryGrid {
    const grid = this.getGrid(version.gridId);
    if (!grid) throw new Error("GRID_NOT_FOUND");
    return { rows: grid.rows, cols: grid.cols, cells: version.cells };
  }

  resultCell(result: StoredResult, row: number, col: number) {
    const idx = indexAt(row, col, result.cols);
    return {
      row,
      col,
      distanceSquared: result.distances[idx],
      sourceRow: result.sourceRows[idx],
      sourceCol: result.sourceCols[idx]
    };
  }
}
