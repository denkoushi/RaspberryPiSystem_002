export type TableColumnDefinition = {
  key: string;
  label: string;
  dataType?: 'date' | 'text' | 'number';
};

type ColumnWidthOptions<Row extends Record<string, unknown>> = {
  columns: TableColumnDefinition[];
  rows: Row[];
  containerWidth: number;
  fontSizePx: number;
  scale?: number;
  fixedWidths?: Record<string, number | null | undefined>;
  formatCellValue?: (column: TableColumnDefinition, value: unknown) => string;
};

const DEFAULT_MIN_WIDTH = 60;

export function computeColumnWidths<Row extends Record<string, unknown>>(
  options: ColumnWidthOptions<Row>
): number[] {
  const {
    columns,
    rows,
    containerWidth,
    fontSizePx,
    scale = 1,
    fixedWidths,
    formatCellValue
  } = options;

  if (columns.length === 0) {
    return [];
  }

  const fixed = columns.map((col) => {
    const px = fixedWidths?.[col.key];
    return typeof px === 'number' && Number.isFinite(px) && px > 0 ? px : null;
  });

  const basePadding = Math.round(12 * scale);
  const safetyPadding = Math.round(6 * scale);
  const minWidth = Math.max(DEFAULT_MIN_WIDTH, Math.round(fontSizePx * 3));
  const headerFontSizePx = Math.round(fontSizePx + 4);
  const headerBoldFactor = 1.06;

  const requiredWidths = columns.map((col) => {
    const headerEm = approxTextEm(col.label);
    let dataMaxEm = 0;
    for (const row of rows) {
      const value = row[col.key];
      const formatted = formatCellValue ? formatCellValue(col, value) : defaultFormatValue(col, value);
      dataMaxEm = Math.max(dataMaxEm, approxTextEm(formatted));
    }
    const headerWidth = headerEm * Math.max(1, headerFontSizePx) * headerBoldFactor;
    const dataWidth = dataMaxEm * Math.max(1, fontSizePx);
    const textWidth = Math.max(headerWidth, dataWidth);
    const required = Math.ceil(textWidth + basePadding * 2 + safetyPadding);
    return Math.max(minWidth, required);
  });

  const widths = columns.map((_, i) => Math.round(fixed[i] ?? requiredWidths[i]));
  const total = widths.reduce((sum, w) => sum + w, 0);

  if (total <= containerWidth) {
    return widths;
  }

  const scaleDown = containerWidth / total;
  const minWidths = widths.map((w) => Math.min(w, minWidth));
  const scaled = widths.map((w, i) => Math.max(minWidths[i], Math.floor(w * scaleDown)));
  return shrinkToFit(scaled, minWidths, containerWidth);
}

function shrinkToFit(widths: number[], minWidths: number[], containerWidth: number): number[] {
  const total = widths.reduce((sum, w) => sum + w, 0);
  if (total <= containerWidth) {
    return widths;
  }

  const adjustable = widths
    .map((w, i) => ({ w, i }))
    .filter(({ w, i }) => w > minWidths[i])
    .map(({ i }) => i);

  if (adjustable.length === 0) {
    widths[widths.length - 1] -= total - containerWidth;
    return widths;
  }

  let remaining = total - containerWidth;
  const adjustableTotal = adjustable.reduce((sum, i) => sum + (widths[i] - minWidths[i]), 0);
  adjustable.forEach((i) => {
    if (remaining <= 0) return;
    const room = widths[i] - minWidths[i];
    const reduce = adjustableTotal > 0 ? Math.ceil((remaining * room) / adjustableTotal) : 0;
    const applied = Math.min(room, reduce);
    widths[i] -= applied;
    remaining -= applied;
  });

  if (remaining > 0) {
    widths[widths.length - 1] = Math.max(1, widths[widths.length - 1] - remaining);
  }

  return widths;
}

function approxTextEm(text: string): number {
  let used = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    used += code != null && code <= 0xff ? 0.6 : 1.0;
  }
  return used;
}

function defaultFormatValue(column: TableColumnDefinition, value: unknown): string {
  if (value == null) return '';
  const asString = String(value);
  if (column.dataType === 'date') {
    const date = new Date(asString);
    if (Number.isNaN(date.getTime())) {
      return asString;
    }
    return date.toLocaleString('ja-JP');
  }
  return asString;
}
