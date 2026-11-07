import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), create: vi.fn(), transaction: vi.fn() }));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: {
  productionScheduleOutsourceConfig: { findUnique: mocks.findUnique },
  $transaction: mocks.transaction
} }));
vi.mock('../../../../lib/site-directory.js', () => ({ resolveSiteKeyForScopeKey: (key: string) => key.split(' - ')[0] }));

import { DEFAULT_OUTSOURCE_SETTINGS, getLoadBalancingOutsourceSettings, outsourceSettingsSchema, saveLoadBalancingOutsourceSettings, type LoadBalancingOutsourceSettings } from '../load-balancing-outsource-settings.service.js';

const settings = (): LoadBalancingOutsourceSettings => ({ mode: 'part', order: ['vendor', 'minutes', 'due'], vendors: [{
  id: 'stable-1', name: ' 加工業者 ', priority: 2, monthlyCapacityMinutes: 120.5,
  conditions: [{ resourceCds: [' a '], partPrefix: ' AB ', partName: ' 軸 ', maxMinutes: 45.5 }]
}] });
const stored = (value: LoadBalancingOutsourceSettings) => ({ ...value, vendors: value.vendors.map((v) => ({ ...v, vendorId: v.id, conditions: v.conditions.map((c, position) => ({ ...c, position })) })) });

describe('outsource settings persistence and site/shared resolution', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback({
      productionScheduleOutsourceConfig: { upsert: mocks.upsert },
      productionScheduleOutsourceVendor: { deleteMany: mocks.deleteMany, create: mocks.create }
    }));
    mocks.upsert.mockResolvedValue({ id: 'config-site' });
  });
  it('falls back to shared only when the site snapshot is absent', async () => {
    mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(stored(settings()));
    expect(await getLoadBalancingOutsourceSettings('site - terminal')).toEqual(outsourceSettingsSchema.parse(settings()));
    expect(mocks.findUnique.mock.calls.map(([call]) => call.where.csvDashboardId_siteKey.siteKey)).toEqual(['site', 'shared']);
  });
  it('site replaces the complete shared list, including edited names, priorities, mode and order', async () => {
    mocks.findUnique.mockResolvedValueOnce(stored(settings()));
    expect(await getLoadBalancingOutsourceSettings('site')).toEqual(outsourceSettingsSchema.parse(settings()));
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
  });
  it('an explicitly empty site snapshot suppresses every shared vendor', async () => {
    mocks.findUnique.mockResolvedValueOnce(stored(DEFAULT_OUTSOURCE_SETTINGS));
    expect(await getLoadBalancingOutsourceSettings('site')).toEqual(DEFAULT_OUTSOURCE_SETTINGS);
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
  });
  it('shared reads once and missing settings use process/due/minutes/vendor defaults', async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(await getLoadBalancingOutsourceSettings('shared')).toEqual(DEFAULT_OUTSOURCE_SETTINGS);
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
  });
  it('saves normalized values and child conditions atomically, keeping the stable vendor ID', async () => {
    mocks.findUnique.mockResolvedValue(stored(settings()));
    const result = await saveLoadBalancingOutsourceSettings('site - terminal', settings());
    expect(result).toEqual(outsourceSettingsSchema.parse(settings()));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ siteKey: 'site', mode: 'part', order: ['vendor', 'minutes', 'due'] }) }));
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { configId: 'config-site' } });
    expect(mocks.create).toHaveBeenCalledWith({ data: {
      configId: 'config-site', vendorId: 'stable-1', name: '加工業者', priority: 2, monthlyCapacityMinutes: 120.5,
      conditions: { create: [{ resourceCds: ['A'], partPrefix: 'AB', partName: '軸', maxMinutes: 45.5, position: 0 }] }
    } });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it('saves an empty snapshot as a real config; deleting the last vendor does not restore shared', async () => {
    mocks.findUnique.mockResolvedValue(stored(DEFAULT_OUTSOURCE_SETTINGS));
    expect(await saveLoadBalancingOutsourceSettings('site', DEFAULT_OUTSOURCE_SETTINGS)).toEqual(DEFAULT_OUTSOURCE_SETTINGS);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.deleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('preserves NULL and zero limits and zero conditions', async () => {
    const value = settings(); value.vendors[0]!.monthlyCapacityMinutes = null; value.vendors[0]!.conditions = [];
    expect(outsourceSettingsSchema.parse(value).vendors[0]).toMatchObject({ monthlyCapacityMinutes: null, conditions: [] });
    value.vendors[0]!.monthlyCapacityMinutes = 0;
    expect(outsourceSettingsSchema.parse(value).vendors[0]!.monthlyCapacityMinutes).toBe(0);
  });
  it.each([
    (v: LoadBalancingOutsourceSettings) => { v.vendors[0]!.name = '  '; },
    (v: LoadBalancingOutsourceSettings) => { v.vendors[0]!.monthlyCapacityMinutes = -1; },
    (v: LoadBalancingOutsourceSettings) => { v.vendors[0]!.monthlyCapacityMinutes = Infinity; },
    (v: LoadBalancingOutsourceSettings) => { v.vendors[0]!.conditions[0]!.maxMinutes = -1; },
    (v: LoadBalancingOutsourceSettings) => { v.vendors[0]!.priority = 0; },
    (v: LoadBalancingOutsourceSettings) => { v.vendors[0]!.conditions[0]!.resourceCds = [' ']; },
    (v: LoadBalancingOutsourceSettings) => { v.order = ['due', 'due', 'vendor']; },
    (v: LoadBalancingOutsourceSettings) => { v.vendors.push({ ...v.vendors[0]! }); }
  ])('rejects invalid input before any write #%#', async (change) => {
    const value = settings(); change(value);
    await expect(saveLoadBalancingOutsourceSettings('site', value)).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
