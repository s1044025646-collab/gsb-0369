import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../db.js";
import { DistanceService } from "../service.js";
import { validateGrid } from "../validation.js";

let storage: Storage | null = null;

function makeStorage(): { storage: Storage; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "edt-"));
  const path = join(directory, "test.sqlite");
  storage = new Storage(path);
  return { storage, path };
}

afterEach(() => {
  storage?.close();
  storage = null;
});

test("持久化结果后重新打开仍可查询", () => {
  const setup = makeStorage();
  let service = new DistanceService(setup.storage);
  const imported = service.importGrid(validateGrid([[1, 0], [0, 0]]), "persist");
  service.compute(imported.versionId);
  setup.storage.close();

  storage = new Storage(setup.path);
  service = new DistanceService(storage);
  const cell = service.query(imported.versionId, 1, 1);
  assert.equal(cell.distanceSquared, 2);
});

test("添加源点创建新版本且历史版本不变", () => {
  const setup = makeStorage();
  const service = new DistanceService(setup.storage);
  const imported = service.importGrid(validateGrid([[0, 0], [0, 0]]), "versions");
  service.compute(imported.versionId);
  const changed = service.modifySource(imported.gridId, 1, 1, 1, "add");
  service.compute(changed.versionId);
  const versions = service.listVersions(imported.gridId);
  assert.equal(versions.length, 2);
  assert.equal(service.query(imported.versionId, 1, 1).exists, false);
  assert.equal(service.query(changed.versionId, 1, 1).distanceSquared, 0);
});

test("连续修改基于最新版本并保留多个源点", () => {
  const setup = makeStorage();
  const service = new DistanceService(setup.storage);
  const imported = service.importGrid(validateGrid([[0, 0], [0, 0]]), "sequence");
  const first = service.modifySource(imported.gridId, 0, 0, 1, "first");
  const second = service.modifySource(imported.gridId, 1, 1, 1, "second");
  const grid = service.versionGrid(second.versionId);
  assert.deepEqual(grid.cells, [1, 0, 0, 1]);
  assert.equal(first.versionId + 1, second.versionId);
});
