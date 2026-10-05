import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../db.js";
import { createApiServer, listen } from "../api.js";
import { DistanceService } from "../service.js";
import type { Server } from "node:http";

let server: Server | null = null;
let storage: Storage | null = null;

async function request(port: number, path: string, init?: RequestInit & { body?: string }) {
  return fetch(`http://127.0.0.1:${port}${path}`, init);
}

test("HTTP API 可导入、计算、查询和解释", async () => {
  const directory = mkdtempSync(join(tmpdir(), "edt-api-"));
  storage = new Storage(join(directory, "api.sqlite"));
  server = createApiServer({ storage, service: new DistanceService(storage) });
  const port = await listen(server, 0);

  const importedResponse = await request(port, "/grids", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "api", grid: [[1, 0], [0, 0]] })
  });
  assert.equal(importedResponse.status, 201);
  const imported = (await importedResponse.json()) as { versionId: number };

  const computedResponse = await request(port, `/versions/${imported.versionId}/compute`, { method: "POST" });
  assert.equal(computedResponse.status, 200);

  const cellResponse = await request(port, `/versions/${imported.versionId}/cell?row=1&col=1`);
  const cell = (await cellResponse.json()) as { distanceSquared: number };
  assert.equal(cell.distanceSquared, 2);

  const explainResponse = await request(port, `/versions/${imported.versionId}/explain?row=1&col=1`);
  assert.equal(explainResponse.status, 200);
});

test("HTTP API 返回明确参数错误码", async () => {
  const directory = mkdtempSync(join(tmpdir(), "edt-api-"));
  storage?.close();
  storage = new Storage(join(directory, "api-invalid.sqlite"));
  server?.close();
  server = createApiServer({ storage, service: new DistanceService(storage) });
  const port = await listen(server, 0);

  const response = await request(port, "/grids", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grid: [[0, 1], [0]] })
  });
  const payload = (await response.json()) as { error: { code: string } };
  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "GRID_NOT_RECTANGULAR");
});

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  storage?.close();
  server = null;
  storage = null;
});
