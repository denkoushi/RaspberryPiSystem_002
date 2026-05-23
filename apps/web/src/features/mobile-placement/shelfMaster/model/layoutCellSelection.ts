export type ToggleLayoutCellSelectionInput = {
  prevSelected: number[];
  clickedCells: number[];
  multiMode: boolean;
};

/** ソート済み・重複なしのセルインデックス配列 */
export function normalizeCellIndices(cells: number[]): number[] {
  const unique = [...new Set(cells.filter((c) => Number.isInteger(c)))];
  unique.sort((a, b) => a - b);
  return unique;
}

function allCellsSelected(selected: number[], cells: number[]): boolean {
  return cells.length > 0 && cells.every((c) => selected.includes(c));
}

function removeCells(selected: number[], cells: number[]): number[] {
  const remove = new Set(cells);
  return selected.filter((c) => !remove.has(c));
}

function unionCells(selected: number[], cells: number[]): number[] {
  return normalizeCellIndices([...selected, ...cells]);
}

function toggleSingleCell(prevSelected: number[], idx: number, multiMode: boolean): number[] {
  if (!multiMode) {
    return prevSelected.length === 1 && prevSelected[0] === idx ? [] : [idx];
  }
  if (prevSelected.includes(idx)) {
    return prevSelected.filter((c) => c !== idx);
  }
  return [...prevSelected, idx];
}

function toggleMergedBlock(prevSelected: number[], cells: number[]): number[] {
  if (allCellsSelected(prevSelected, cells)) {
    return removeCells(prevSelected, cells);
  }
  return unionCells(prevSelected, cells);
}

/**
 * レイアウト編集 factory-map のセル選択を更新する。
 * 単一マスは multiMode に従いトグル。結合ブロック（複数インデックス）は entity 単位で一括選択／解除。
 */
export function toggleLayoutCellSelection(input: ToggleLayoutCellSelectionInput): number[] {
  const clicked = normalizeCellIndices(input.clickedCells);
  if (clicked.length === 0) {
    return [...input.prevSelected];
  }

  if (clicked.length === 1) {
    return toggleSingleCell(input.prevSelected, clicked[0]!, input.multiMode);
  }

  return toggleMergedBlock(input.prevSelected, clicked);
}
