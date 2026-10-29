import type { AssemblyCheckSheetPayload, AssemblyCheckSheetStampInput } from '@raspi-system/shared-types';
export type CheckItem = AssemblyCheckSheetPayload['revision']['items'][number];
export type CheckStamp = AssemblyCheckSheetPayload['stamps'][number];
export type CheckDraft = {
  values: Record<string, string>; result: 'OK' | 'NG' | 'NA' | null;
  ngReason: string; ngAction: 'flag' | 'pause' | null;
};
export const emptyDraft = (): CheckDraft => ({ values: {}, result: null, ngReason: '', ngAction: null });
export const roleLabel = (key: string) => ({ general: '一般', leader: '班長', section_chief: '係長', manager: '課長', general_manager: '部長', executive: '役員' }[key] ?? key);
export const familyName = (name: string) => name.trim().split(/[\s\u3000]+/)[0];
export const stampTime = (stamp: CheckStamp) => new Date(stamp.stampedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
export const stageScale = (width: number, height: number) => Math.min(1, width / 1920, height / 1080);
export function nextOpenItem(sheet: AssemblyCheckSheetPayload, from: string | null): string | null {
  const items = sheet.revision.items;
  const start = items.findIndex((item) => item.id === from);
  const open = (item: CheckItem) => {
    const stamp = sheet.stamps.find((entry) => entry.itemId === item.id);
    return !stamp || (stamp.result === 'NG' && !stamp.flagged);
  };
  return items.find((item, index) => index > start && open(item))?.id ?? items.find(open)?.id ?? null;
}
export function canComplete(sheet: AssemblyCheckSheetPayload) {
  return sheet.status === 'IN_PROGRESS' && sheet.revision.items.length > 0 && sheet.revision.items.every((item) =>
    sheet.stamps.some((stamp) => stamp.itemId === item.id && stamp.result !== 'NG' && !stamp.flagged));
}
export function stampInput(item: CheckItem, draft: CheckDraft, condition: 'applies' | 'na' | undefined, uid: string): AssemblyCheckSheetStampInput | null {
  if (item.conditionKey && condition !== 'applies') return null;
  if (!draft.result || (draft.result === 'NG' && (!draft.ngAction || (draft.ngAction === 'flag' && !draft.ngReason.trim())))) return null;
  const values: Record<string, string | number> = {};
  for (const field of item.inputSpec.fields ?? []) {
    const value = draft.values[field.key]?.trim() ?? '';
    if (!value && draft.result === 'NG') continue;
    if (!value || (item.inputKind === 'NUMBER' && !Number.isFinite(Number(value)))) return null;
    values[field.key] = item.inputKind === 'NUMBER' ? Number(value) : value;
  }
  if (item.inputKind === 'CHOICE') {
    const choice = draft.values.result;
    if (!item.inputSpec.options?.includes(choice)) return null;
    values.result = choice;
  }
  return { itemId: item.id, result: draft.result, values: draft.result === 'NA' ? {} : values,
    flagged: draft.result === 'NG' && draft.ngAction === 'flag', ngReason: draft.ngReason, nfcTagUid: uid };
}
