// HTTP API（Node 内置 http，无外部依赖）。错误统一返回 { error: { code, message } }。
import http from "node:http";
import { Store, ApiError } from "./store.js";
import { explainCell, edt1d } from "./edt.js";

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, (_k, v) => (v === Infinity ? "Infinity" : v));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError("INVALID_INPUT", "请求体不是合法 JSON");
  }
}

function parseCoordPairs(v: unknown, name: string): Array<[number, number]> {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ApiError("INVALID_INPUT", `${name} 必须是 [row,col] 数组`);
  return v.map((p) => {
    if (!Array.isArray(p) || p.length !== 2) throw new ApiError("INVALID_INPUT", `${name} 元素必须是 [row,col]`);
    return [p[0], p[1]] as [number, number];
  });
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";
      if (method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true });
      }
      if (method === "GET" && url.pathname === "/grids") {
        return send(res, 200, { grids: store.list() });
      }
      if (method === "POST" && url.pathname === "/grids") {
        const body = await readBody(req);
        let data: number[][];
        if (body.data !== undefined) {
          data = body.data;
        } else if (body.rows !== undefined && body.cols !== undefined) {
          data = Array.from({ length: body.rows }, () => new Array(body.cols).fill(0));
          for (const [r, c] of parseCoordPairs(body.sources, "sources")) {
            if (r < 0 || c < 0 || r >= body.rows || c >= body.cols)
              throw new ApiError("INVALID_INPUT", `源点 (${r},${c}) 越界`);
            data[r][c] = 1;
          }
        } else {
          throw new ApiError("INVALID_INPUT", "需要 data 矩阵或 rows/cols/sources");
        }
        const id = store.createGrid(data);
        return send(res, 201, { id });
      }
      if (parts[0] === "grids" && parts.length >= 2) {
        const id = Number(parts[1]);
        if (!Number.isInteger(id)) throw new ApiError("INVALID_INPUT", "id 必须为整数");
        const action = parts[2];
        if (method === "GET" && !action) return send(res, 200, { ...store.info(id), ...store.getGrid(id) });
        if (method === "POST" && action === "compute") {
          const r = store.compute(id);
          return send(res, 200, { id, status: "complete", rows: r.rows, cols: r.cols });
        }
        if (method === "GET" && action === "result") return send(res, 200, store.getResult(id));
        if (method === "GET" && action === "cell") {
          const r = Number(url.searchParams.get("r"));
          const c = Number(url.searchParams.get("c"));
          return send(res, 200, store.cell(id, r, c));
        }
        if (method === "GET" && action === "explain") {
          const { data } = store.getGrid(id);
          const limit = Math.max(1, Number(url.searchParams.get("limit") ?? 64));
          const clip = (e: any) => ({
            ...e,
            candidates: e.candidates.slice(0, limit),
            truncated: e.candidates.length > limit,
          });
          if (url.searchParams.has("r") && url.searchParams.has("c")) {
            const expl = explainCell(data, Number(url.searchParams.get("r")), Number(url.searchParams.get("c")));
            return send(res, 200, { ...expl, pass2: clip(expl.pass2), pass1: expl.pass1 && clip(expl.pass1) });
          }
          const axis = url.searchParams.get("axis");
          const index = Number(url.searchParams.get("index"));
          if (axis === "row") {
            if (index < 0 || index >= data.length) throw new ApiError("INVALID_INPUT", "行号越界");
            return send(res, 200, clip(edt1d(data[index].map((v) => (v === 1 ? 0 : Infinity)), "row", index).expl));
          }
          if (axis === "col") {
            if (index < 0 || index >= data[0].length) throw new ApiError("INVALID_INPUT", "列号越界");
            const full = explainCell(data, 0, index);
            return send(res, 200, clip(full.pass2));
          }
          throw new ApiError("INVALID_INPUT", "需要 r&c 或 axis=row|col&index=");
        }
        if (method === "POST" && action === "sources") {
          const body = await readBody(req);
          const newId = store.deriveGrid(id, parseCoordPairs(body.add, "add"), parseCoordPairs(body.remove, "remove"));
          return send(res, 201, { id: newId, parentId: id });
        }
        if (method === "GET" && action === "export") {
          const r = store.getResult(id);
          const fmt = (v: number) => (Number.isFinite(v) ? String(v) : ".");
          const text = r.dist2.map((row) => row.map(fmt).join(" ")).join("\n") + "\n";
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end(text);
        }
      }
      throw new ApiError("NOT_FOUND", `${method} ${url.pathname} 不存在`, 404);
    } catch (err) {
      if (err instanceof ApiError) return send(res, err.status, { error: { code: err.code, message: err.message } });
      return send(res, 500, { error: { code: "INTERNAL", message: String(err) } });
    }
  });
}
