import { searchPartIndex } from '@raspi-system/part-search-core';

import { normalizeMachineName } from '../../../kiosk/productionSchedule/machineName';

import type { PartSearchFilter, PartSearchIndex } from '@raspi-system/part-search-core';

export function pickSpeechSearchText(texts: string[], index: PartSearchIndex, filters: PartSearchFilter[]): string {
  const machines = index.map(({ row }) => normalizeMachineName(row.machineName));
  const candidates = texts.map((text) => {
    const normalized = text.normalize('NFKC').trim().replace(/\s+/g, ' ');
    const machineKey = normalizeMachineName(normalized.replace(/\s/g, ''));
    return machines.find((machine) => machine.replace(/\s/g, '') === machineKey) ?? normalized;
  }).filter(Boolean);
  return candidates.find((typed) => searchPartIndex(index, { field: 'all', typed, filters }).total > 0)
    ?? candidates[0] ?? '';
}
