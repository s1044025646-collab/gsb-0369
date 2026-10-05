import {
  indexAt,
  type BinaryGrid,
  type CellExplanation,
  type DistanceResult,
  type PassExplanation,
  type ActiveInterval,
  type EnvelopeCandidate,
  type PoppedCandidate
} from "./types.js";

interface OneDInput {
  values: Array<number | null>;
  ownerRows: Array<number | null>;
  ownerCols: Array<number | null>;
}

interface OneDOutput {
  values: Array<number | null>;
  ownerRows: Array<number | null>;
  ownerCols: Array<number | null>;
}

interface EnvelopeState {
  positions: number[];
  starts: number[];
  candidates: EnvelopeCandidate[];
  popped: PoppedCandidate[];
}

function ownerLess(
  leftRow: number | null,
  leftCol: number | null,
  rightRow: number | null,
  rightCol: number | null
): boolean {
  if (leftRow === null || leftCol === null) return false;
  if (rightRow === null || rightCol === null) return true;
  return leftRow < rightRow || (leftRow === rightRow && leftCol < rightCol);
}

function ceilDivPositive(numerator: number, denominator: number): number {
  return Math.floor(numerator / denominator) + (numerator % denominator === 0 ? 0 : 1);
}

function buildEnvelope(input: OneDInput): EnvelopeState {
  const count = input.values.length;
  const positions: number[] = [];
  const starts: number[] = [];
  const candidates: EnvelopeCandidate[] = [];
  const popped: PoppedCandidate[] = [];

  for (let position = 0; position < count; position += 1) {
    const value = input.values[position];
    const sourceRow = input.ownerRows[position];
    const sourceCol = input.ownerCols[position];

    if (value === null) {
      candidates.push({
        position,
        value: null,
        sourceRow: null,
        sourceCol: null,
        included: false,
        skipReason: "infinite-cost"
      });
      continue;
    }

    const candidate: EnvelopeCandidate = {
      position,
      value,
      sourceRow,
      sourceCol,
      included: true
    };

    let discardedByTie = false;
    while (positions.length > 0) {
      const oldPosition = positions[positions.length - 1];
      const oldRow = input.ownerRows[oldPosition]!;
      const oldCol = input.ownerCols[oldPosition]!;
      const oldValue = input.values[oldPosition]!;

      let start: number;
      let intersectionNumerator: number;
      let intersectionDenominator: number;

      intersectionNumerator = value + position * position - oldValue - oldPosition * oldPosition;
      intersectionDenominator = 2 * (position - oldPosition);
      const exactInteger = intersectionNumerator % intersectionDenominator === 0;
      start = exactInteger
        ? intersectionNumerator / intersectionDenominator
        : ceilDivPositive(intersectionNumerator, intersectionDenominator);
      if (exactInteger && !ownerLess(sourceRow, sourceCol, oldRow, oldCol)) start += 1;

      if (start >= count) {
        candidates.push({ ...candidate, included: false, skipReason: "never-active" });
        discardedByTie = true;
        break;
      }

      const intersectionValue = intersectionNumerator / intersectionDenominator;
      if (start <= starts[starts.length - 1]) {
        const previousStart = starts[starts.length - 1];
        positions.pop();
        popped.push({
          position: oldPosition,
          intersectionNumerator,
          intersectionDenominator,
          intersectionValue,
          proposedStart: start,
          previousStart,
          reason: "covered-by-newer-candidate"
        });
        starts.pop();
      } else {
        positions.push(position);
        starts.push(start);
        candidates.push(candidate);
        break;
      }
    }

    if (!discardedByTie && positions.length === 0) {
      positions.push(position);
      starts.push(0);
      candidates.push(candidate);
    }
  }

  return { positions, starts, candidates, popped };
}

function scanEnvelope(input: OneDInput, state: EnvelopeState): OneDOutput {
  const count = input.values.length;
  const values: Array<number | null> = new Array(count).fill(null);
  const ownerRows: Array<number | null> = new Array(count).fill(null);
  const ownerCols: Array<number | null> = new Array(count).fill(null);

  let active = 0;
  for (let position = 0; position < count; position += 1) {
    while (active + 1 < state.positions.length && position >= state.starts[active + 1]) {
      active += 1;
    }
    const candidatePosition = state.positions[active];
    if (candidatePosition !== undefined) {
      const delta = position - candidatePosition;
      values[position] = input.values[candidatePosition]! + delta * delta;
      ownerRows[position] = input.ownerRows[candidatePosition];
      ownerCols[position] = input.ownerCols[candidatePosition];
    }
  }
  return { values, ownerRows, ownerCols };
}

function transform1D(input: OneDInput): { output: OneDOutput; state: EnvelopeState } {
  const state = buildEnvelope(input);
  return { output: scanEnvelope(input, state), state };
}

function intervalsForState(state: EnvelopeState, count: number): ActiveInterval[] {
  return state.positions.map((position, index) => ({
    position,
    start: state.starts[index],
    end: index + 1 < state.starts.length ? state.starts[index + 1] - 1 : count - 1
  }));
}

function passExplanation(
  direction: "vertical" | "horizontal",
  fixedPosition: number,
  input: OneDInput,
  selected: number,
  state: EnvelopeState
): PassExplanation {
  const output = scanEnvelope(input, state);
  return {
    direction,
    fixedPosition,
    processedPositionName: direction === "vertical" ? "row" : "column",
    candidates: state.candidates,
    popped: state.popped,
    activeIntervals: intervalsForState(state, input.values.length),
    selectedPosition: selected,
    selectedSourceRow: output.ownerRows[selected],
    selectedSourceCol: output.ownerCols[selected],
    selectedValue: output.values[selected]
  };
}

export function computeDistanceTransform(grid: BinaryGrid): DistanceResult {
  const { rows, cols, cells } = grid;
  const verticalValues: Array<number | null> = new Array(rows * cols).fill(null);
  const verticalRows: Array<number | null> = new Array(rows * cols).fill(null);
  const verticalCols: Array<number | null> = new Array(rows * cols).fill(null);

  for (let col = 0; col < cols; col += 1) {
    const values: Array<number | null> = new Array(rows).fill(null);
    const ownerRows: Array<number | null> = new Array(rows).fill(null);
    const ownerCols: Array<number | null> = new Array(rows).fill(null);
    for (let row = 0; row < rows; row += 1) {
      if (cells[indexAt(row, col, cols)] === 1) {
        values[row] = 0;
        ownerRows[row] = row;
        ownerCols[row] = col;
      }
    }
    const { output } = transform1D({ values, ownerRows, ownerCols });
    for (let row = 0; row < rows; row += 1) {
      const target = indexAt(row, col, cols);
      verticalValues[target] = output.values[row];
      verticalRows[target] = output.ownerRows[row];
      verticalCols[target] = output.ownerCols[row];
    }
  }

  const distances: Array<number | null> = new Array(rows * cols).fill(null);
  const sourceRows: Array<number | null> = new Array(rows * cols).fill(null);
  const sourceCols: Array<number | null> = new Array(rows * cols).fill(null);

  for (let row = 0; row < rows; row += 1) {
    const start = row * cols;
    const input: OneDInput = {
      values: verticalValues.slice(start, start + cols),
      ownerRows: verticalRows.slice(start, start + cols),
      ownerCols: verticalCols.slice(start, start + cols)
    };
    const { output } = transform1D(input);
    for (let col = 0; col < cols; col += 1) {
      distances[start + col] = output.values[col];
      sourceRows[start + col] = output.ownerRows[col];
      sourceCols[start + col] = output.ownerCols[col];
    }
  }

  return {
    rows,
    cols,
    distances,
    sourceRows,
    sourceCols,
    hasAnySource: cells.some((cell) => cell === 1)
  };
}

export function explainCell(grid: BinaryGrid, targetRow: number, targetCol: number): CellExplanation {
  const { rows, cols, cells } = grid;

  const verticalInputs: OneDInput[] = [];
  for (let col = 0; col < cols; col += 1) {
    const values: Array<number | null> = new Array(rows).fill(null);
    const ownerRows: Array<number | null> = new Array(rows).fill(null);
    const ownerCols: Array<number | null> = new Array(rows).fill(null);
    for (let row = 0; row < rows; row += 1) {
      if (cells[indexAt(row, col, cols)] === 1) {
        values[row] = 0;
        ownerRows[row] = row;
        ownerCols[row] = col;
      }
    }
    verticalInputs.push({ values, ownerRows, ownerCols });
  }

  const verticalOutputs = verticalInputs.map((input) => transform1D(input));
  const targetVertical = verticalOutputs[targetCol];
  const vertical = passExplanation(
    "vertical",
    targetCol,
    verticalInputs[targetCol],
    targetRow,
    targetVertical.state
  );

  const horizontalInput: OneDInput = {
    values: verticalOutputs.map((entry, col) => entry.output.values[targetRow] ?? null),
    ownerRows: verticalOutputs.map((entry) => entry.output.ownerRows[targetRow]),
    ownerCols: verticalOutputs.map((entry) => entry.output.ownerCols[targetRow])
  };
  const horizontalTransform = transform1D(horizontalInput);
  const horizontal = passExplanation(
    "horizontal",
    targetRow,
    horizontalInput,
    targetCol,
    horizontalTransform.state
  );

  const distance = horizontalTransform.output.values[targetCol];
  const sourceRow = horizontalTransform.output.ownerRows[targetCol];
  const sourceCol = horizontalTransform.output.ownerCols[targetCol];

  return {
    targetRow,
    targetCol,
    coordinateConvention: "row-index-then-column-index-zero-based",
    firstPass: "columns-from-top-to-bottom",
    secondPass: "rows-from-left-to-right",
    vertical,
    horizontal,
    finalDistanceSquared: distance,
    finalSourceRow: sourceRow,
    finalSourceCol: sourceCol,
    squareRootApproximation: distance === null ? null : Math.sqrt(distance)
  };
}

export function bruteForceReference(grid: BinaryGrid): DistanceResult {
  const sources: Array<{ row: number; col: number }> = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      if (grid.cells[indexAt(row, col, grid.cols)] === 1) sources.push({ row, col });
    }
  }

  const distances = new Array<number | null>(grid.rows * grid.cols).fill(null);
  const sourceRows = new Array<number | null>(grid.rows * grid.cols).fill(null);
  const sourceCols = new Array<number | null>(grid.rows * grid.cols).fill(null);

  if (sources.length === 0) {
    return { rows: grid.rows, cols: grid.cols, distances, sourceRows, sourceCols, hasAnySource: false };
  }

  sources.sort((left, right) => left.row - right.row || left.col - right.col);
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      let bestDistance = Number.POSITIVE_INFINITY;
      let best = sources[0];
      for (const source of sources) {
        const dr = row - source.row;
        const dc = col - source.col;
        const distance = dr * dr + dc * dc;
        if (
          distance < bestDistance ||
          (distance === bestDistance &&
            (source.row < best.row || (source.row === best.row && source.col < best.col)))
        ) {
          bestDistance = distance;
          best = source;
        }
      }
      const idx = indexAt(row, col, grid.cols);
      distances[idx] = bestDistance;
      sourceRows[idx] = best.row;
      sourceCols[idx] = best.col;
    }
  }
  return { rows: grid.rows, cols: grid.cols, distances, sourceRows, sourceCols, hasAnySource: true };
}
