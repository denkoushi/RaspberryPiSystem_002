import { SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL } from '../production-schedule/constants.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../production-schedule/seiban-machine-display-names.service.js';

/**
 * 購買照会用: 機種名が解決できなければ空文字（「機種名未登録」ラベルは付けない）。
 */
export async function resolveMachineNameForPurchaseLookup(seibanRaw: string): Promise<string> {
  const batch = await resolveMachineNamesForPurchaseLookup([seibanRaw]);
  return batch[seibanRaw.trim()] ?? '';
}

/**
 * 購買照会用: 製番集合の機種名をまとめて解決し、未解決は空文字に揃える。
 */
export async function resolveMachineNamesForPurchaseLookup(rawSeibans: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(rawSeibans.map((value) => value.trim()).filter((value) => value.length > 0)));
  if (unique.length === 0) {
    return {};
  }

  const resolved = await resolveSeibanMachineDisplayNamesBatched(unique);
  const machineNames: Record<string, string> = {};
  for (const seiban of unique) {
    const value = resolved.machineNames[seiban];
    machineNames[seiban] =
      value == null || value.trim().length === 0 || value === SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL
        ? ''
        : value.trim();
  }
  return machineNames;
}
