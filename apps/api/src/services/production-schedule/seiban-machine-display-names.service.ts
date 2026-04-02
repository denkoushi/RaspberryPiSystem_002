import { fetchSeibanProgressRows } from './seiban-progress.service.js';

const SEIBAN_MACHINE_DISPLAY_NAMES_MAX = 100;

const normalizeSeibanMachineDisplayNameInputs = (items: string[]): string[] => {
  const unique = new Set<string>();
  const next: string[] = [];
  items
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .forEach((item) => {
      if (unique.has(item)) return;
      unique.add(item);
      next.push(item);
    });
  return next.slice(0, SEIBAN_MACHINE_DISPLAY_NAMES_MAX);
};

/**
 * 製番リストから機種表示名（MH/SH 行の FHINMEI）を解決する。
 * 手動順番 overview / history-progress と同一の {@link fetchSeibanProgressRows} を利用する。
 */
export async function resolveSeibanMachineDisplayNames(rawFseibans: string[]): Promise<{
  machineNames: Record<string, string | null>;
}> {
  const fseibans = normalizeSeibanMachineDisplayNameInputs(rawFseibans);
  if (fseibans.length === 0) {
    return { machineNames: {} };
  }

  const progressRows = await fetchSeibanProgressRows(fseibans);
  const machineNames: Record<string, string | null> = {};
  for (const f of fseibans) {
    machineNames[f] = null;
  }
  for (const row of progressRows) {
    const key = row.fseiban?.trim() ?? '';
    if (key.length === 0) continue;
    machineNames[key] = row.machineName ?? null;
  }

  return { machineNames };
}
