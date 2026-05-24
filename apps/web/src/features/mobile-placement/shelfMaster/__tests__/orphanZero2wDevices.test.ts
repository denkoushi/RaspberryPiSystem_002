import { describe, expect, it } from 'vitest';

import {
  collectShelfCodesOnZoneMap,
  findOrphanZero2wDevicesInZone
} from '../zero2wPreset/orphanZero2wDevices';

import type { DraftEntity } from '../model/shelfLayoutTypes';

const shelfEntity = (shelfCodeRaw: string): DraftEntity => ({
  entityKind: 'SHELF',
  cellIndices: [0],
  resourceCd: null,
  resourceName: null,
  shelfCodeRaw,
  displayLabel: shelfCodeRaw,
  aisleLabel: null
});

const devices = [
  { id: 'pi-1', name: 'zero2w-tanaban01', shelfCodeRaw: '中央-南-03' },
  { id: 'pi-2', name: 'Pi-2', shelfCodeRaw: '中央-南-05' },
  { id: 'pi-3', name: 'Pi-3', shelfCodeRaw: '西-北-01' },
  { id: 'pi-4', name: 'Pi-4', shelfCodeRaw: null }
];

describe('collectShelfCodesOnZoneMap', () => {
  it('collects SHELF shelf codes only', () => {
    const codes = collectShelfCodesOnZoneMap([
      shelfEntity('中央-南-05'),
      {
        entityKind: 'MACHINE',
        cellIndices: [1],
        resourceCd: 'cd1',
        resourceName: 'M1',
        shelfCodeRaw: null,
        displayLabel: 'M1',
        aisleLabel: null
      }
    ]);
    expect([...codes]).toEqual(['中央-南-05']);
  });
});

describe('findOrphanZero2wDevicesInZone', () => {
  it('flags preset not on zone map with matching prefix', () => {
    const zoneCodes = collectShelfCodesOnZoneMap([shelfEntity('中央-南-05')]);
    const orphans = findOrphanZero2wDevicesInZone(devices, zoneCodes, '中央-南');
    expect(orphans).toEqual([
      {
        deviceId: 'pi-1',
        deviceName: 'zero2w-tanaban01',
        presetShelfCodeRaw: '中央-南-03'
      }
    ]);
  });

  it('returns empty when preset matches map shelf', () => {
    const zoneCodes = collectShelfCodesOnZoneMap([shelfEntity('中央-南-05')]);
    const orphans = findOrphanZero2wDevicesInZone(
      [{ id: 'pi-2', name: 'Pi-2', shelfCodeRaw: '中央-南-05' }],
      zoneCodes,
      '中央-南'
    );
    expect(orphans).toHaveLength(0);
  });

  it('ignores presets from other macro zones', () => {
    const zoneCodes = collectShelfCodesOnZoneMap([shelfEntity('中央-南-05')]);
    const orphans = findOrphanZero2wDevicesInZone(
      [{ id: 'pi-3', name: 'Pi-3', shelfCodeRaw: '西-北-01' }],
      zoneCodes,
      '中央-南'
    );
    expect(orphans).toHaveLength(0);
  });

  it('lists multiple orphans', () => {
    const zoneCodes = collectShelfCodesOnZoneMap([shelfEntity('中央-南-05')]);
    const orphans = findOrphanZero2wDevicesInZone(
      [
        { id: 'pi-1', name: 'A', shelfCodeRaw: '中央-南-03' },
        { id: 'pi-2', name: 'B', shelfCodeRaw: '中央-南-04' }
      ],
      zoneCodes,
      '中央-南'
    );
    expect(orphans).toHaveLength(2);
  });
});
