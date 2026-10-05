#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Storage } from "./db.js";
import { DistanceService } from "./service.js";
import { parseGridFromRows, validateGrid, ValidationError } from "./validation.js";

type Json = unknown;

function print(value: Json): void {
  console.log(JSON.stringify(value, null, 2));
}

function usage(): never {
  console.error(`用法:
  edt demo
  edt import --name 名称 --row 0,1,0 --row 0,0,0
  edt compute --version 1
  edt query --version 1 --row 0 --col 0
  edt explain --version 1 --row 0 --col 0
  edt add-source --grid 1 --row 2 --col 2
  edt remove-source --grid 1 --row 2 --col 2
  edt export --version 1 [--out result.json]

环境:
  EDT_DB_PATH=data/edt.sqlite
`);
  process.exitCode = 1;
  throw new Error("INVALID_USAGE");
}

function parseArgs(argv: string[]): Map<string, string[]> {
  const args = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) usage();
    const key = token.slice(2);
    if (key === "help") usage();
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args.set(key, [...(args.get(key) ?? []), "true"]);
    } else {
      args.set(key, [...(args.get(key) ?? []), next]);
      index += 1;
    }
  }
  return args;
}

function requiredNumber(args: Map<string, string[]>, key: string): number {
  const value = Number(args.get(key)?.[0]);
  if (!Number.isInteger(value)) throw new ValidationError("INVALID_CLI_ARGUMENT", `--${key} 必须是整数`);
  return value;
}

function rowsFromArgs(args: Map<string, string[]>) {
  const rows = (args.get("row") ?? []).map((row) => `[${row}]`);
  if (rows.length === 0) usage();
  return parseGridFromRows(rows);
}

function runDemo(service: DistanceService): void {
  const centerGrid = validateGrid([
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0]
  ]);
  const first = service.importGrid(centerGrid, "demo-5x5-center");
  const firstResult = service.compute(first.versionId);

  const symmetricGrid = validateGrid([
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0]
  ]);
  const second = service.importGrid(symmetricGrid, "demo-5x5-symmetric");
  const secondResult = service.compute(second.versionId);

  print({
    title: "5x5 中心单源点：四个角落平方距离必须为 8",
    first,
    corners: [
      service.query(first.versionId, 0, 0),
      service.query(first.versionId, 0, 4),
      service.query(first.versionId, 4, 0),
      service.query(first.versionId, 4, 4)
    ],
    distanceSquaredMatrix: chunk(firstResult.distances, 5),
    symmetric: {
      second,
      distanceSquaredMatrix: chunk(secondResult.distances, 5),
      tieExample: service.query(second.versionId, 2, 0),
      tieExplanation: service.explain(second.versionId, 2, 0)
    }
  });
}

function chunk<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

async function main(): Promise<void> {
  const [command, ...rawArgs] = process.argv.slice(2);
  if (!command || command === "--help") usage();

  const dbPath = resolve(process.env.EDT_DB_PATH ?? "data/edt.sqlite");
  mkdirSync(resolve(dirnamePath(dbPath)), { recursive: true });
  const storage = new Storage(dbPath);
  const service = new DistanceService(storage);

  try {
    const args = parseArgs(rawArgs);
    switch (command) {
      case "demo":
        runDemo(service);
        break;
      case "import": {
        const grid = rowsFromArgs(args);
        print(service.importGrid(grid, args.get("name")?.[0] ?? "cli-grid"));
        break;
      }
      case "compute":
        print(service.compute(requiredNumber(args, "version")));
        break;
      case "query":
        print(service.query(requiredNumber(args, "version"), requiredNumber(args, "row"), requiredNumber(args, "col")));
        break;
      case "explain":
        print(service.explain(requiredNumber(args, "version"), requiredNumber(args, "row"), requiredNumber(args, "col")));
        break;
      case "add-source":
        print(service.modifySource(
          requiredNumber(args, "grid"),
          requiredNumber(args, "row"),
          requiredNumber(args, "col"),
          1,
          "cli-add-source"
        ));
        break;
      case "remove-source":
        print(service.modifySource(
          requiredNumber(args, "grid"),
          requiredNumber(args, "row"),
          requiredNumber(args, "col"),
          0,
          "cli-remove-source"
        ));
        break;
      case "export": {
        const payload = service.exportMatrices(requiredNumber(args, "version"));
        if (args.has("out")) writeFileSync(resolve(args.get("out")![0]), JSON.stringify(payload, null, 2), "utf8");
        print(payload);
        break;
      }
      default:
        usage();
    }
  } finally {
    storage.close();
  }
}

function dirnamePath(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join("/") || ".";
}

main().catch((error: unknown) => {
  if (error instanceof Error && error.message === "INVALID_USAGE") return;
  if (error instanceof ValidationError) {
    console.error(JSON.stringify({ error: { code: error.code, message: error.message, details: error.details } }, null, 2));
    process.exitCode = 2;
  } else {
    console.error(error);
    process.exitCode = 1;
  }
});
