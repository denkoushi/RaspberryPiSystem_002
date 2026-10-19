import { SeibanMachineNameSupplementRepository } from './seiban-machine-name-supplement.repository.js';
import { isMissingSeibanMachineName } from './seiban-machine-name-state.js';

const SUPPLEMENT_LOOKUP_CHUNK_SIZE = 1000;

/**
 * MH/SH 行から機種名を引けなかった製番について、補完テーブル（FHINMEI_MH_SH CSV 同期）の機種名を返す。
 * 既に機種名がある製番は問い合わせない。未登録ラベルは返さず、補完にも無い製番は結果に含めない。
 * 解決順は {@link resolveSeibanMachineDisplayNames} と同じ（MH/SH 行の FHINMEI → 補完テーブル）。
 */
export async function findSupplementMachineNamesForMissing(
  entries: Iterable<readonly [fseiban: string | null | undefined, machineName: string | null | undefined]>
): Promise<Map<string, string>> {
  const missing = new Set<string>();
  for (const [rawFseiban, machineName] of entries) {
    const fseiban = rawFseiban?.trim() ?? '';
    if (fseiban.length > 0 && isMissingSeibanMachineName(machineName)) {
      missing.add(fseiban);
    }
  }

  const result = new Map<string, string>();
  if (missing.size === 0) {
    return result;
  }

  const repo = new SeibanMachineNameSupplementRepository();
  const fseibans = [...missing];
  for (let offset = 0; offset < fseibans.length; offset += SUPPLEMENT_LOOKUP_CHUNK_SIZE) {
    const found = await repo.findByFseibans(fseibans.slice(offset, offset + SUPPLEMENT_LOOKUP_CHUNK_SIZE));
    for (const [fseiban, machineName] of found) {
      if (!isMissingSeibanMachineName(machineName)) {
        result.set(fseiban, machineName.trim());
      }
    }
  }
  return result;
}
