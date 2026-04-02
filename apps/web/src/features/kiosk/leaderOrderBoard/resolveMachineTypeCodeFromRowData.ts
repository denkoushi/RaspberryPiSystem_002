/**
 * 生産日程 CSV の rowData から「機種記号」（例: DAD3350）を取り出す。
 * 本番で列が無い場合は CSV ダッシュボードの columnDefinitions にいずれかの internalName を追加する。
 *
 * 優先順は現場で列が追加されやすい一般的なラベル候補（確定仕様ではないため複数試行）。
 */
const MACHINE_TYPE_CODE_KEYS = [
  'FKISYU',
  'FKISHU',
  'FKIGIS',
  'FMODEL',
  'FMACHINE',
  'machineTypeCode',
  'KISHU',
  'FKMEI'
] as const;

const strField = (data: Record<string, unknown>, key: string): string => {
  const v = data[key];
  return typeof v === 'string' ? v.trim() : '';
};

export function resolveMachineTypeCodeFromRowData(data: Record<string, unknown>): string {
  for (const key of MACHINE_TYPE_CODE_KEYS) {
    const v = strField(data, key);
    if (v.length > 0) {
      return v;
    }
  }
  return '';
}
