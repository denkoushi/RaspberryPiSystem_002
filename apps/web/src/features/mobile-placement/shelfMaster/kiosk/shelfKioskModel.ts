import { composeArea, splitArea } from '@raspi-system/shelf-layout-core';

import { normalizeMachineName } from '../../../kiosk/productionSchedule/machineName';

import type { RegisteredShelfEntryDto } from '../../registeredShelves';
import type { ShelfQueueRecord } from '../offline/shelfOfflineQueueStore';

export const compassDirections = ['北西', '北', '北東', '西', '', '東', '南西', '南', '南東'] as const;
export type KioskShelf = { shelfCodeRaw: string; shelf?: RegisteredShelfEntryDto; record?: ShelfQueueRecord };
export type Landmark = { name: string; kind: string; other?: boolean };
export function shelfPosition(code: string, marks: Landmark[]) {
  const { machine, direction } = splitArea(code);
  if (marks.some((mark) => !mark.other && mark.name === machine) && code === (direction ? composeArea(machine, direction) : machine)) {
    return { machine, direction: direction ?? '' };
  }
  return null;
}
export const displayName = (name: string) => normalizeMachineName(name);
