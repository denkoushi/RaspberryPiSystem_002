import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), create: vi.fn(), transaction: vi.fn(), namedDelete: vi.fn(), namedCreate: vi.fn() }));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: {
  productionScheduleOutsourceConfig: { findUnique: mocks.findUnique },
  $transaction: mocks.transaction
} }));
vi.mock('../../../../lib/site-directory.js', () => ({ resolveSiteKeyForScopeKey: (key: string) => key.split(' - ')[0] }));

import { DEFAULT_OUTSOURCE_SETTINGS, getLoadBalancingOutsourceSettings, outsourceSettingsSchema, saveLoadBalancingOutsourceSettings, type LoadBalancingOutsourceSettings } from '../load-balancing-outsource-settings.service.js';

const settings = (): LoadBalancingOutsourceSettings => ({ namedTargets: [{ kind: 'machine', key: ' NVD ', vendorId: 'stable-1' }], mode: 'part', order: ['vendor', 'minutes', 'due'], vendors: [{
  id: 'stable-1', name: ' 加工業者 ', priority: 2, monthlyCapacityMinutes: 120.5,
  conditions: [{ resourceCds: [' a '], partPrefix: ' AB ', partName: ' 軸 ', maxMinutes: 45.5 }]
}] });
const stored = (value: LoadBalancingOutsourceSettings) => ({ ...value, vendors: value.vendors.map((v) => ({ ...v, vendorId: v.id, conditions: v.conditions.map((c, position) => ({ ...c, position })) })) });

describe('outsource settings persistence and site/shared resolution', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback({
      productionScheduleOutsourceConfig: { upsert: mocks.upsert },
      productionScheduleOutsourceNamedTarget: { deleteMany: mocks.namedDelete, create: mocks.namedCreate },
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
  it('replaces named children atomically and drops them when their vendor is removed', async () => {
    const value = settings();
    mocks.findUnique.mockResolvedValue(stored(value));
    await saveLoadBalancingOutsourceSettings('shared', value);
    expect(mocks.namedCreate).toHaveBeenCalledWith({ data: { kind: 'machine', key: 'NVD', vendorId: 'stable-1', configId: 'config-site', position: 0 } });
    expect(mocks.namedDelete).toHaveBeenCalledWith({ where: { configId: 'config-site' } });
    expect(mocks.namedDelete.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteMany.mock.invocationCallOrder[0]!);
    mocks.namedCreate.mockClear();
    mocks.findUnique.mockResolvedValue(stored(DEFAULT_OUTSOURCE_SETTINGS));
    await saveLoadBalancingOutsourceSettings('shared', DEFAULT_OUTSOURCE_SETTINGS);
    expect(mocks.namedCreate).not.toHaveBeenCalled();
  });
  it('reads orphaned and duplicate named targets without writing, keeping the first valid target', async () => {
    const value = settings();
    value.vendors.push({ ...value.vendors[0]!, id: 'stable-2' });
    value.namedTargets = [
      { kind: 'seiban', key: 'orphan', vendorId: 'deleted' },
      { kind: 'machine', key: ' NVD ', vendorId: 'stable-1' },
      { kind: 'machine', key: 'NVD', vendorId: 'stable-2' },
      { kind: 'seiban', key: 'S1', vendorId: 'stable-2' },
      { kind: 'seiban', key: 'S1', vendorId: 'stable-1' }
    ];
    mocks.findUnique.mockResolvedValue(stored(value));
    const result = await getLoadBalancingOutsourceSettings('site');
    expect(result.namedTargets).toEqual([
      { kind: 'machine', key: 'NVD', vendorId: 'stable-1' },
      { kind: 'seiban', key: 'S1', vendorId: 'stable-2' }
    ]);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(outsourceSettingsSchema.safeParse(result).success).toBe(true);
    // Saving the cleaned read snapshot replaces the stored named children normally.
    await saveLoadBalancingOutsourceSettings('site', result);
    expect(mocks.namedDelete).toHaveBeenCalledTimes(1);
    expect(mocks.namedCreate).toHaveBeenCalledTimes(2);
    expect(mocks.namedCreate.mock.calls.map(([call]) => call.data.vendorId)).toEqual(['stable-1', 'stable-2']);
  });

  it('accepts old requests without namedTargets and adds an empty list', () => {
    const { namedTargets: _targets, ...legacy } = settings();
    expect(outsourceSettingsSchema.parse(legacy).namedTargets).toEqual([]);
  });
  it('preserves NULL and zero limits and zero conditions', async () => {
    const value = settings(); value.vendors[0]!.monthlyCapacityMinutes = null; value.vendors[0]!.conditions = [];
    expect(outsourceSettingsSchema.parse(value).vendors[0]).toMatchObject({ monthlyCapacityMinutes: null, conditions: [] });
    value.vendors[0]!.monthlyCapacityMinutes = 0;
    expect(outsourceSettingsSchema.parse(value).vendors[0]!.monthlyCapacityMinutes).toBe(0);
  });
  it.each([
    (v: LoadBalancingOutsourceSettings) => { v.namedTargets[0]!.key = '  '; },
    (v: LoadBalancingOutsourceSettings) => { v.namedTargets[0]!.kind = 'invalid' as never; },
    (v: LoadBalancingOutsourceSettings) => { v.namedTargets[0]!.vendorId = 'missing'; },
    (v: LoadBalancingOutsourceSettings) => { v.namedTargets.push({ ...v.namedTargets[0]!, key: 'NVD' }); },
    (v: LoadBalancingOutsourceSettings) => { v.vendors = []; },
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
