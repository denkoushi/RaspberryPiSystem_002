/**
 * 訓練メニューを「材質（行）× 呼び径・首下長さ（列）」の表へ並べる。
 * 同じ行・列に2つ目のメニューがある場合は、同じ見出しの行を追加して
 * どのメニューも隠さない。
 */

export type TorqueTrainingMatrixVersion = {
  id: string;
  nominalDiameter: string;
  boltLengthMm: string;
  material: string;
  strengthClass: string;
};

export type TorqueTrainingMatrixColumn = {
  key: string;
  nominalDiameter: string;
  boltLengthMm: string;
};

export type TorqueTrainingMatrixRow<T> = {
  key: string;
  material: string;
  strengthClass: string;
  cells: Array<T | null>;
};

export type TorqueTrainingMatrix<T> = {
  columns: TorqueTrainingMatrixColumn[];
  rows: Array<TorqueTrainingMatrixRow<T>>;
};

function diameterValue(nominalDiameter: string): number {
  const parsed = Number.parseFloat(nominalDiameter.replace(/^[^\d.]+/, ''));
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function lengthValue(boltLengthMm: string): number {
  const parsed = Number.parseFloat(boltLengthMm);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function columnKey(version: TorqueTrainingMatrixVersion): string {
  return `${version.nominalDiameter}|${lengthValue(version.boltLengthMm)}`;
}

export function buildTorqueTrainingMatrix<T extends TorqueTrainingMatrixVersion>(versions: T[]): TorqueTrainingMatrix<T> {
  const columnsByKey = new Map<string, TorqueTrainingMatrixColumn>();
  for (const version of versions) {
    const key = columnKey(version);
    if (!columnsByKey.has(key)) {
      columnsByKey.set(key, { key, nominalDiameter: version.nominalDiameter, boltLengthMm: version.boltLengthMm });
    }
  }
  const columns = [...columnsByKey.values()].sort((left, right) => (
    diameterValue(left.nominalDiameter) - diameterValue(right.nominalDiameter)
    || lengthValue(left.boltLengthMm) - lengthValue(right.boltLengthMm)
    || left.nominalDiameter.localeCompare(right.nominalDiameter)
  ));
  const columnIndex = new Map(columns.map((column, index) => [column.key, index]));

  const rows: Array<TorqueTrainingMatrixRow<T>> = [];
  for (const version of versions) {
    const groupKey = `${version.material}|${version.strengthClass}`;
    const index = columnIndex.get(columnKey(version))!;
    let row = rows.find((candidate) => candidate.key.startsWith(`${groupKey}#`) && candidate.cells[index] === null);
    if (!row) {
      const sameGroupCount = rows.filter((candidate) => candidate.key.startsWith(`${groupKey}#`)).length;
      row = {
        key: `${groupKey}#${sameGroupCount}`,
        material: version.material,
        strengthClass: version.strengthClass,
        cells: columns.map(() => null)
      };
      rows.push(row);
    }
    row.cells[index] = version;
  }
  return { columns, rows };
}
