export const MAX_DIMENSION = 512;
export const ALGORITHM_VERSION = "separable-squared-euclidean-2d/1.0.0";

export interface BinaryGrid {
  rows: number;
  cols: number;
  cells: number[];
}

export interface CellResult {
  row: number;
  col: number;
  distanceSquared: number | null;
  sourceRow: number | null;
  sourceCol: number | null;
}

export interface DistanceResult {
  rows: number;
  cols: number;
  distances: Array<number | null>;
  sourceRows: Array<number | null>;
  sourceCols: Array<number | null>;
  hasAnySource: boolean;
}

export interface EnvelopeCandidate {
  position: number;
  value: number | null;
  sourceRow: number | null;
  sourceCol: number | null;
  included: boolean;
  skipReason?: "infinite-cost" | "tie-loses" | "never-active";
}

export interface PoppedCandidate {
  position: number;
  intersectionNumerator: number;
  intersectionDenominator: number;
  intersectionValue: number;
  proposedStart: number;
  previousStart: number;
  reason: "covered-by-newer-candidate";
}

export interface ActiveInterval {
  position: number;
  start: number;
  end: number | null;
}

export interface PassExplanation {
  direction: "vertical" | "horizontal";
  fixedPosition: number;
  processedPositionName: "row" | "column";
  candidates: EnvelopeCandidate[];
  popped: PoppedCandidate[];
  activeIntervals: ActiveInterval[];
  selectedPosition: number;
  selectedSourceRow: number | null;
  selectedSourceCol: number | null;
  selectedValue: number | null;
}

export interface CellExplanation {
  targetRow: number;
  targetCol: number;
  coordinateConvention: "row-index-then-column-index-zero-based";
  firstPass: "columns-from-top-to-bottom";
  secondPass: "rows-from-left-to-right";
  vertical: PassExplanation;
  horizontal: PassExplanation;
  finalDistanceSquared: number | null;
  finalSourceRow: number | null;
  finalSourceCol: number | null;
  squareRootApproximation: number | null;
}

export function indexAt(row: number, col: number, cols: number): number {
  return row * cols + col;
}

export function isCellResult(result: CellResult): boolean {
  return result.distanceSquared !== null && result.sourceRow !== null && result.sourceCol !== null;
}
