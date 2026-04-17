import { SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL } from './constants.js';
import { fetchSeibanProgressRows } from './seiban-progress.service.js';
import { SeibanMachineNameSupplementRepository } from './seiban-machine-name-supplement.repository.js';

export const SEIBAN_MACHINE_DISPLAY_NAMES_MAX = 100;

const normalizeSeibanMachineDisplayNameInputs = (
  items: string[],
  max: number | null = SEIBAN_MACHINE_DISPLAY_NAMES_MAX
): string[] => {
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
  if (max == null) {
    return next;
  }
  return next.slice(0, max);
};

const isBlankMachineName = (value: string | null | undefined): boolean =>
  value == null || String(value).trim().length === 0;

/**
 * 製番リストから機種表示名（MH/SH 行の FHINMEI）を解決する。
 * 手動順番 overview / history-progress と同一の {@link fetchSeibanProgressRows} を優先し、
 * 不足分は Gmail 補完CSV同期テーブル、最終的に {@link SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL} を返す。
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

  const needSupplement = fseibans.filter((f) => isBlankMachineName(machineNames[f]));
  if (needSupplement.length > 0) {
    const supplementRepo = new SeibanMachineNameSupplementRepository();
    const supplementMap = await supplementRepo.findByFseibans(needSupplement);
    for (const f of needSupplement) {
      const s = supplementMap.get(f);
      if (s != null && !isBlankMachineName(s)) {
        machineNames[f] = s;
      }
    }
  }

  for (const f of fseibans) {
    if (isBlankMachineName(machineNames[f])) {
      machineNames[f] = SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL;
    }
  }

  return { machineNames };
}

/**
 * 大量製番向け: 既存の 100 件解決関数をバッチ実行し、同じ解決順序で全件を返す。
 * （MH/SH -> 補完テーブル -> 機種名未登録）
 */
export async function resolveSeibanMachineDisplayNamesBatched(rawFseibans: string[]): Promise<{
  machineNames: Record<string, string | null>;
}> {
  const fseibans = normalizeSeibanMachineDisplayNameInputs(rawFseibans, null);
  if (fseibans.length === 0) {
    return { machineNames: {} };
  }
  if (fseibans.length <= SEIBAN_MACHINE_DISPLAY_NAMES_MAX) {
    return resolveSeibanMachineDisplayNames(fseibans);
  }

  const machineNames: Record<string, string | null> = {};
  for (let offset = 0; offset < fseibans.length; offset += SEIBAN_MACHINE_DISPLAY_NAMES_MAX) {
    const chunk = fseibans.slice(offset, offset + SEIBAN_MACHINE_DISPLAY_NAMES_MAX);
    const resolved = await resolveSeibanMachineDisplayNames(chunk);
    Object.assign(machineNames, resolved.machineNames);
  }
  return { machineNames };
}
