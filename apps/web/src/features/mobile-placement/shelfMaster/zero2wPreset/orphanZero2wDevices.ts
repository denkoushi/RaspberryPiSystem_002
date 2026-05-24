import type { HaizenTargetDeviceOption } from './zero2wPiSelectOptions';
import type { DraftEntity } from '../model/shelfLayoutTypes';

export type OrphanZero2wDevice = {
  deviceId: string;
  deviceName: string;
  presetShelfCodeRaw: string;
};

/**
 * 区画ドラフト上の部品置き場（SHELF）棚番を収集する。
 */
export function collectShelfCodesOnZoneMap(draftEntities: DraftEntity[]): Set<string> {
  const codes = new Set<string>();
  for (const entity of draftEntities) {
    if (entity.entityKind !== 'SHELF') {
      continue;
    }
    const code = entity.shelfCodeRaw?.trim();
    if (code) {
      codes.add(code);
    }
  }
  return codes;
}

function presetBelongsToZone(presetShelfCodeRaw: string, zoneShelfPrefix: string): boolean {
  return presetShelfCodeRaw.startsWith(`${zoneShelfPrefix}-`);
}

/**
 * 当区画の地図に存在しない preset 棚番を持つ Zero2W 端末を列挙する。
 */
export function findOrphanZero2wDevicesInZone(
  devices: HaizenTargetDeviceOption[],
  zoneShelfCodes: Set<string>,
  zoneShelfPrefix: string
): OrphanZero2wDevice[] {
  const orphans: OrphanZero2wDevice[] = [];

  for (const device of devices) {
    const preset = device.shelfCodeRaw?.trim();
    if (!preset) {
      continue;
    }
    if (zoneShelfCodes.has(preset)) {
      continue;
    }
    if (!presetBelongsToZone(preset, zoneShelfPrefix)) {
      continue;
    }
    orphans.push({
      deviceId: device.id,
      deviceName: device.name,
      presetShelfCodeRaw: preset
    });
  }

  return orphans;
}
