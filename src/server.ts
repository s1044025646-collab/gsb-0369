import { resolve } from "node:path";
import { Storage } from "./db.js";
import { createApiServer, listen } from "./api.js";
import { DistanceService } from "./service.js";

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`端口无效: ${value}`);
  }
  return port;
}

async function main(): Promise<void> {
  const dbPath = resolve(process.env.EDT_DB_PATH ?? "data/edt.sqlite");
  const storage = new Storage(dbPath);
  const server = createApiServer({ storage, service: new DistanceService(storage) });
  const port = await listen(server, parsePort(process.env.PORT));

  console.log(JSON.stringify({
    message: "二值网格距离变换 API 已启动",
    baseUrl: `http://127.0.0.1:${port}`,
    database: dbPath
  }));

  function shutdown(): void {
    server.close(() => storage.close());
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
