import type { AssemblyCheckSheetCellWrite, AssemblyCheckSheetPayload } from '@raspi-system/shared-types';

const tokyo = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
export function buildCheckSheetWrites(sheet: AssemblyCheckSheetPayload): AssemblyCheckSheetCellWrite[] {
  const writes: AssemblyCheckSheetCellWrite[] = [];
  for (const [key, cell] of Object.entries(sheet.revision.headerCellMap)) {
    if (Object.hasOwn(sheet.headerValues, key)) writes.push({ cell, text: sheet.headerValues[key] });
  }
  for (const item of sheet.revision.items) {
    const stamp = sheet.stamps.find((entry) => entry.itemId === item.id);
    if (!stamp) continue;
    const name = stamp.employeeNameSnapshot.trim().split(/[ \u3000]/)[0];
    const parts = Object.fromEntries(tokyo.formatToParts(new Date(stamp.stampedAt)).map((part) => [part.type, part.value]));
    const text = stamp.result === 'NA' ? `該当なし ${name}` : stamp.result === 'NG' ? `NG ${name}`
      : `${name} ${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
    const target = item.valueTarget;
    // NA and NG without measurements preserve the original blank/template text.
    if (stamp.result !== 'NA' && Object.keys(stamp.values).length) {
      const value = target.mode === 'inline'
        ? target.template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_, key: string) => Object.hasOwn(stamp.values, key) ? String(stamp.values[key]) : '')
        : [
          ...(item.inputKind === 'CHOICE' && Object.hasOwn(stamp.values, 'result') ? [String(stamp.values.result)] : []),
          ...(item.inputSpec.fields ?? []).filter((field) => Object.hasOwn(stamp.values, field.key))
            .map((field) => `${stamp.values[field.key]}${field.unit ? ` ${field.unit}` : ''}`)
        ].join(' / ');
      writes.push({ cell: target.cell, text: value });
    }
    writes.push({ cell: item.stampCell, text });
  }
  return writes;
}
