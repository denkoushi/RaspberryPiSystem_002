import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { machineSignalSensor: mocks } }));

import { listMachineSignalSensors, updateMachineSignalSensor } from '../machine-signal-settings.service.js';

const sensor = {
  signalNo: 1, resourceCd: null, sourceMachineName: '機械', displayName: null, site: null,
  kind: 'MACHINE' as const, hidden: false, plannedStartMinute: null, plannedEndMinute: null,
  runningKw: null, idleKw: null, categoryOverrides: {},
};

describe('sensor resource code', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findUnique.mockResolvedValue(sensor);
    mocks.update.mockImplementation(async ({ data }) => ({ ...sensor, ...data }));
  });
  it.each([[' ０２１ ', '021'], ['　ａｂＣ　', 'ABC'], ['', null], ['　 ', null], [null, null]])(
    'normalizes %s to %s and returns it', async (input, expected) => {
      expect(await updateMachineSignalSensor(1, { ...sensor, resourceCd: input })).toMatchObject({ resourceCd: expected });
      expect(mocks.update.mock.calls[0][0].data.resourceCd).toBe(expected);
    }
  );
  it('preserves the mapping when an older caller omits the field', async () => {
    const { resourceCd: _resourceCd, ...input } = sensor;
    await updateMachineSignalSensor(1, input);
    expect(mocks.update.mock.calls[0][0].data.resourceCd).toBeUndefined();
  });
  it('includes the mapping in the sensor DTO', async () => {
    mocks.findMany.mockResolvedValue([{ ...sensor, resourceCd: '021' }]);
    expect(await listMachineSignalSensors()).toEqual([{ ...sensor, resourceCd: '021' }]);
  });
});
