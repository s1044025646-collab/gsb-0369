// 精确平方欧氏距离变换（可分离两遍算法，Felzenszwalb-Huttenlocher 风格，
// 自行实现，不依赖任何图像库）。坐标约定：row 为行号（y，向下增大），
// col 为列号（x，向右增大）。第一遍沿行处理（每一行做一维变换），
// 第二遍沿列处理。平局规则：源点按 (row, col) 字典序取较小者。

export const INF = Number.POSITIVE_INFINITY;
export const MAX_DIM = 512;

export interface CandidateInfo {
  q: number; // 一维位置
  f: number; // 输入代价 f(q)，Infinity 表示该位置不可能是源
  skipped: boolean; // f 为 Infinity 时被明确跳过，不参与交点计算
}

export interface EnvelopeEntry {
  q: number; // 抛物线所在位置
  f: number;
  boundary: number; // 与上一条包络抛物线的交点 s：x > s 时本条更优（x == s 平局归小号）
  lo: number; // 生效的整数区间 [lo, hi]
  hi: number;
}

export interface EliminatedInfo {
  q: number;
  by: number; // 被哪个新候选淘汰
  at: number; // 淘汰时新候选与其交点 s
  reason: string;
}

export interface OneDExplanation {
  axis: "row" | "col"; // row: 第一遍（沿列方向扫描某一行）；col: 第二遍（沿行方向扫描某一列）
  index: number; // 行号或列号
  length: number;
  candidates: CandidateInfo[];
  envelope: EnvelopeEntry[];
  eliminated: EliminatedInfo[];
}

export interface OneDResult {
  d: number[]; // 每个位置的 min_q f(q) + (x - q)^2
  arg: number[]; // 取到最小值的 q（平局取较小 q）；无有限候选时为 -1
  expl: OneDExplanation;
}

// 一维平方距离下包络。f 中 Infinity 候选被跳过（绝不与有限数混算交点）。
export function edt1d(f: number[], axis: "row" | "col", index: number): OneDResult {
  const n = f.length;
  const d = new Array<number>(n).fill(INF);
  const arg = new Array<number>(n).fill(-1);
  const expl: OneDExplanation = { axis, index, length: n, candidates: [], envelope: [], eliminated: [] };

  const finite: number[] = [];
  for (let q = 0; q < n; q++) {
    const skip = !Number.isFinite(f[q]);
    expl.candidates.push({ q, f: f[q], skipped: skip });
    if (!skip) finite.push(q);
  }
  if (finite.length === 0) return { d, arg, expl };

  // v: 包络抛物线位置；z: 交点边界，z[k] < x <= z[k+1] 时 v[k] 胜出（整数位置、平局归小号）
  const v: number[] = [];
  const z: number[] = [];

  const intersect = (p: number, q: number): number =>
    ((f[q] + q * q) - (f[p] + p * p)) / (2 * (q - p));

  for (const q of finite) {
    let s = -INF;
    while (v.length > 0) {
      const p = v[v.length - 1];
      s = intersect(p, q);
      const start = z[v.length - 1];
      // s <= start：p 的生效区间被 q 完全覆盖（s == start 时 p 仅在单点平局，仍归小号，淘汰）
      if (s <= start) {
        expl.eliminated.push({
          q: p,
          by: q,
          at: s,
          reason: `候选 q=${p} 被 q=${q} 在交点 ${s} 处完全覆盖，生效区间为空`,
        });
        v.pop();
        z.pop();
        continue;
      }
      break;
    }
    v.push(q);
    z.push(v.length === 1 ? -INF : s);
  }
  z.push(INF);

  for (let k = 0; k < v.length; k++) {
    const lo = z[k] === -INF ? 0 : Math.floor(z[k]) + 1;
    const hi = z[k + 1] === INF ? n - 1 : Math.floor(z[k + 1]);
    expl.envelope.push({ q: v[k], f: f[v[k]], boundary: z[k], lo, hi });
  }

  let k = 0;
  for (let x = 0; x < n; x++) {
    while (z[k + 1] < x) k++; // x == z[k+1] 为平局，归较小 q，不前进
    d[x] = f[v[k]] + (x - v[k]) * (x - v[k]);
    arg[x] = v[k];
  }
  return { d, arg, expl };
}

export interface GridResult {
  rows: number;
  cols: number;
  dist2: number[][]; // 平方距离；无源点时为 Infinity
  srcRow: number[][]; // 最近源点行；-1 表示不存在
  srcCol: number[][];
}

export function validateGrid(rows: number, cols: number, data: number[][]): string | null {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1)
    return "rows/cols 必须为正整数";
  if (rows > MAX_DIM || cols > MAX_DIM) return `每维上限为 ${MAX_DIM}`;
  if (!Array.isArray(data) || data.length !== rows) return "data 行数与 rows 不符";
  for (const r of data) {
    if (!Array.isArray(r) || r.length !== cols) return "data 列数与 cols 不符";
    for (const v of r) if (v !== 0 && v !== 1) return "网格只能包含 0/1";
  }
  return null;
}

// 完整两遍变换。第一遍沿行（对每行做一维），第二遍沿列。
export function edt2d(grid: number[][]): GridResult {
  const rows = grid.length;
  const cols = grid[0].length;

  // 第一遍：每行，f(q) = 0（源点）或 Infinity
  const d1: number[][] = [];
  const a1: number[][] = []; // 该格在第一遍选中的源点列
  for (let r = 0; r < rows; r++) {
    const f = grid[r].map((v) => (v === 1 ? 0 : INF));
    const res = edt1d(f, "row", r);
    d1.push(res.d);
    a1.push(res.arg);
  }

  // 第二遍：每列，f(y) = d1[y][c]；来源列由 a1 传递，保证坐标确实达到返回距离
  const dist2: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(INF));
  const srcRow: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  const srcCol: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  for (let c = 0; c < cols; c++) {
    const f = new Array<number>(rows);
    for (let r = 0; r < rows; r++) f[r] = d1[r][c];
    const res = edt1d(f, "col", c);
    for (let r = 0; r < rows; r++) {
      dist2[r][c] = res.d[r];
      const y = res.arg[r];
      if (y >= 0) {
        srcRow[r][c] = y;
        srcCol[r][c] = a1[y][c];
      }
    }
  }
  return { rows, cols, dist2, srcRow, srcCol };
}

export interface CellExplanation {
  row: number;
  col: number;
  dist2: number;
  sqrtApprox: number | null;
  source: { row: number; col: number } | null;
  pass2: OneDExplanation; // 第二遍：该列沿行方向的一维问题
  pass2Winner: number; // 第二遍在 x=row 处胜出的 y（即源点行）
  pass1: OneDExplanation | null; // 第一遍：源点所在行沿列方向的一维问题
  pass1Winner: number; // 第一遍在 x=col 处胜出的 q（即源点列）
  note: string;
}

// 对单个格子给出完整解释：重算涉及的一维问题（计算范围仍是完整行/列，
// 展示上限由调用方控制，二者分离）。
export function explainCell(grid: number[][], row: number, col: number): CellExplanation {
  const rows = grid.length;
  const cols = grid[0].length;
  const result = edt2d(grid);
  const dist2 = result.dist2[row][col];
  const sr = result.srcRow[row][col];
  const sc = result.srcCol[row][col];

  const f2 = new Array<number>(rows);
  // 需要第一遍的行结果来构造第二遍输入
  const d1: number[][] = [];
  for (let r = 0; r < rows; r++) {
    d1.push(edt1d(grid[r].map((v) => (v === 1 ? 0 : INF)), "row", r).d);
  }
  for (let r = 0; r < rows; r++) f2[r] = d1[r][col];
  const pass2 = edt1d(f2, "col", col).expl;

  let pass1: OneDExplanation | null = null;
  let pass1Winner = -1;
  if (sr >= 0) {
    const res1 = edt1d(grid[sr].map((v) => (v === 1 ? 0 : INF)), "row", sr);
    pass1 = res1.expl;
    pass1Winner = res1.arg[col];
  }

  return {
    row,
    col,
    dist2,
    sqrtApprox: Number.isFinite(dist2) ? Math.sqrt(dist2) : null,
    source: sr >= 0 ? { row: sr, col: sc } : null,
    pass2,
    pass2Winner: sr,
    pass1,
    pass1Winner,
    note:
      "坐标约定：row 向下、col 向右，原点 (0,0) 在左上。第一遍沿行处理（固定行、沿列方向求一维变换），" +
      "第二遍沿列处理（固定列、沿行方向）。交点恰为整数时该位置平局，归 (row,col) 字典序更小的源点。",
  };
}

// 独立基准：逐格枚举全部源点（仅用于测试对照，不是正式算法）
export function bruteForce(grid: number[][]): GridResult {
  const rows = grid.length;
  const cols = grid[0].length;
  const sources: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) if (grid[r][c] === 1) sources.push([r, c]);
  const dist2: number[][] = [];
  const srcRow: number[][] = [];
  const srcCol: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const dr: number[] = [];
    const srr: number[] = [];
    const scc: number[] = [];
    for (let c = 0; c < cols; c++) {
      let best = INF;
      let br = -1;
      let bc = -1;
      for (const [sr, sc] of sources) {
        const dd = (r - sr) * (r - sr) + (c - sc) * (c - sc);
        if (dd < best || (dd === best && (sr < br || (sr === br && sc < bc)))) {
          best = dd;
          br = sr;
          bc = sc;
        }
      }
      dr.push(best);
      srr.push(br);
      scc.push(bc);
    }
    dist2.push(dr);
    srcRow.push(srr);
    srcCol.push(scc);
  }
  return { rows, cols, dist2, srcRow, srcCol };
}
