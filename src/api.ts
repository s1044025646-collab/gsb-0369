import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { Storage } from "./db.js";
import { DistanceService } from "./service.js";
import { ALGORITHM_VERSION } from "./types.js";
import { validateGrid, ValidationError } from "./validation.js";

export interface ApiContext {
  storage: Storage;
  service: DistanceService;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16 * 1024 * 1024) {
      throw new ValidationError("REQUEST_TOO_LARGE", "请求体不能超过 16 MiB");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ValidationError("INVALID_JSON", "请求体必须是合法 JSON");
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError("INVALID_REQUEST", "请求体必须是 JSON 对象");
  }
  return value as Record<string, unknown>;
}

function integerParam(params: URLSearchParams, name: string): number {
  const raw = params.get(name);
  const value = Number(raw);
  if (raw === null || !Number.isInteger(value)) {
    throw new ValidationError("INVALID_QUERY_PARAMETER", `查询参数 ${name} 必须是整数`, { name, value: raw });
  }
  return value;
}

export function createApiServer(context: ApiContext): Server {
  const { service } = context;
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const method = request.method ?? "GET";

      if (method === "GET" && path === "/health") {
        sendJson(response, 200, { ok: true, algorithmVersion: ALGORITHM_VERSION });
        return;
      }

      if (method === "POST" && path === "/grids") {
        const body = objectRecord(await readJson(request));
        const grid = validateGrid(body.grid ?? body.cells);
        const name = typeof body.name === "string" ? body.name : undefined;
        const created = service.importGrid(grid, name);
        sendJson(response, 201, { ...created, complete: false });
        return;
      }

      let match = /^\/grids\/(\d+)\/versions$/.exec(path);
      if (method === "GET" && match) {
        sendJson(response, 200, { versions: service.listVersions(Number(match[1])) });
        return;
      }

      match = /^\/versions\/(\d+)\/compute$/.exec(path);
      if (method === "POST" && match) {
        const result = service.compute(Number(match[1]));
        sendJson(response, 200, result);
        return;
      }

      match = /^\/versions\/(\d+)\/cell$/.exec(path);
      if (method === "GET" && match) {
        sendJson(
          response,
          200,
          service.query(
            Number(match[1]),
            integerParam(url.searchParams, "row"),
            integerParam(url.searchParams, "col")
          )
        );
        return;
      }

      match = /^\/versions\/(\d+)\/explain$/.exec(path);
      if (method === "GET" && match) {
        sendJson(
          response,
          200,
          service.explain(
            Number(match[1]),
            integerParam(url.searchParams, "row"),
            integerParam(url.searchParams, "col")
          )
        );
        return;
      }

      match = /^\/versions\/(\d+)\/export$/.exec(path);
      if (method === "GET" && match) {
        sendJson(response, 200, service.exportMatrices(Number(match[1])));
        return;
      }

      match = /^\/grids\/(\d+)\/sources$/.exec(path);
      if (method === "POST" && match) {
        const body = objectRecord(await readJson(request));
        const enabled = body.enabled === undefined ? 1 : body.enabled;
        if (enabled !== 0 && enabled !== 1) {
          throw new ValidationError("INVALID_ENABLED", "enabled 只能是 0 或 1");
        }
        const label = typeof body.label === "string" ? body.label : "source-modification";
        const created = service.modifySource(
          Number(match[1]),
          body.row,
          body.col,
          enabled,
          label
        );
        sendJson(response, 201, created);
        return;
      }

      sendJson(response, 404, { error: { code: "ROUTE_NOT_FOUND", message: "API 路径不存在" } });
    } catch (error) {
      if (error instanceof ValidationError) {
        sendJson(response, 400, { error: { code: error.code, message: error.message, details: error.details } });
      } else if (error instanceof Error && error.message === "GRID_NOT_FOUND") {
        sendJson(response, 404, { error: { code: "GRID_NOT_FOUND", message: "网格不存在" } });
      } else {
        sendJson(response, 500, {
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "未知错误"
          }
        });
      }
    }
  });
}

export async function listen(server: Server, preferredPort?: number): Promise<number> {
  const port = preferredPort ?? 0;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return address.port;
}
