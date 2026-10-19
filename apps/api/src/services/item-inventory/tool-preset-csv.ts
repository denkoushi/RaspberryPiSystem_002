/**
 * Turns a supplier tool list (CSV with 径, 材質, 削り方向, 型番, メーカー columns) into
 * pre-registered choices for the kiosk pop-up. Decided with the user on 2026-09-30:
 * 径 → toolSize, 材質 → workMaterial, 削り方向 → usage, 型番 → model, メーカー → maker;
 * "・"-joined values become separate choices (型番 is kept whole).
 */
export type ToolPresetField = 'maker' | 'toolName' | 'workMaterial' | 'toolSize' | 'model' | 'usage';
export type ToolPreset = { field: ToolPresetField; value: string };

const COLUMNS: Array<{ header: string; field: ToolPresetField; split: boolean }> = [
  { header: '径', field: 'toolSize', split: true },
  { header: '材質', field: 'workMaterial', split: true },
  { header: '削り方向', field: 'usage', split: true },
  { header: '型番', field: 'model', split: false },
  { header: 'メーカー', field: 'maker', split: false },
];

function clean(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

/** "φ20・50・100" → φ20, φ50, φ100 (the diameter mark carries over to bare numbers). */
function splitParts(field: ToolPresetField, raw: string): string[] {
  const parts = raw.split('・').map(clean).filter(Boolean);
  if (field !== 'toolSize') return parts;
  const mark = parts[0]?.match(/^[φΦ]/)?.[0];
  return parts.map((part) => (mark && /^\d/.test(part) ? `${mark}${part}` : part));
}

export function parseToolPresetCsv(text: string): { presets: ToolPreset[]; warnings: string[] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { presets: [], warnings: ['CSVが空です'] };
  const header = lines[0].split(',').map(clean);
  const warnings: string[] = [];
  const indexes = COLUMNS.map((column) => ({ ...column, index: header.indexOf(column.header) }));
  for (const column of indexes) {
    if (column.index < 0) warnings.push(`列「${column.header}」がありません`);
  }
  const seen = new Set<string>();
  const presets: ToolPreset[] = [];
  lines.slice(1).forEach((line, row) => {
    const cells = line.split(',');
    for (const column of indexes) {
      if (column.index < 0) continue;
      const raw = cells[column.index] ?? '';
      const values = column.split ? splitParts(column.field, raw) : [clean(raw)].filter(Boolean);
      for (const value of values) {
        if (value.includes('?')) warnings.push(`${row + 2}行目 ${column.header}「${value}」に読めない文字（?）があります`);
        const key = `${column.field}\u0000${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        presets.push({ field: column.field, value });
      }
    }
  });
  return { presets, warnings };
}
