import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../../production-schedule/seiban-machine-display-names.service.js';
import { getHaizenOrderTrail } from '../order-trail.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: Object.fromEntries([
  'csvDashboardRow', 'productionScheduleResourceMaster', 'orderPlacementBranchState', 'haizenCurrentPlacement',
  'orderPlacementEvent', 'mobileSlipVerifyRecord', 'productionScheduleFkojunstMailStatus',
  'productionScheduleActualHoursCanonical', 'machinePalletEvent', 'haizenScanEvent', 'purchaseOrderLookupRow'
].map(name => [name, { findMany: vi.fn() }])) }));
vi.mock('../../production-schedule/seiban-machine-display-names.service.js', () => ({ resolveSeibanMachineDisplayNamesBatched: vi.fn() }));
const order = '0002178005';
const at = new Date('2026-10-28T15:30:00Z');
const snapshot = { ProductNo: order, FSEIBAN: 'FS1', FHINCD: 'MD1(A)-002', FHINMEI: 'ブラケット', FKOJUN: '2', FSIGENCD: 'R1' };
beforeEach(() => {
  vi.resetAllMocks();
  for (const model of Object.values(prisma)) vi.mocked(model.findMany).mockResolvedValue([]);
  vi.mocked(resolveSeibanMachineDisplayNamesBatched).mockResolvedValue({ machineNames: { FS1: '機械' } });
});

describe('order trail', () => {
  it('returns null when no source knows the order', async () => {
    expect(await getHaizenOrderTrail(order)).toBeNull();
  });
  it('maps every step status with mail > status > progress precedence and numeric order, deduplicating steps', async () => {
    const states = [
      { process: '10', mail: 'C', normal: 'S', completed: false },
      { process: '2', mail: 'S', normal: 'C', completed: true },
      { process: '3', mail: 'R', normal: 'C', completed: true },
      { process: '4', mail: 'X' }, { process: '5', mail: 'P', completed: true },
      { process: '6', normal: 'S', completed: true }, { process: '7', completed: true },
      { process: '8', completed: false }, { process: '9', mail: '?' }, { process: '10', mail: 'P' }
    ];
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue(states.map(row => ({ rowData: { ...snapshot, FKOJUN: row.process },
      fkojunstMailStatus: row.mail ? { statusCode: row.mail } : null,
      fkojunstStatus: row.normal ? { statusCode: row.normal } : null,
      productionScheduleProgress: { isCompleted: row.completed ?? false } })) as never);
    vi.mocked(prisma.productionScheduleResourceMaster.findMany).mockResolvedValue([{ resourceCd: 'R1', resourceName: '切削' }] as never);
    const trail = await getHaizenOrderTrail(order);
    expect(trail).toMatchObject({ orderNo: order, fseiban: 'FS1', fhincd: 'MD1(A)-002', fhinmei: 'ブラケット', machineName: '機械' });
    expect(trail?.steps.map(row => [row.processOrder, row.status, row.tone])).toEqual([
      ['2', '現場着手', 'active'], ['3', '移動票発行', 'waiting'], ['4', '外注', 'waiting'],
      ['5', '未確定', 'none'], ['6', '現場着手', 'active'], ['7', '加工完了', 'done'],
      ['8', '未確定', 'none'], ['9', '未確定', 'none'], ['10', '加工完了', 'done']
    ]);
    expect(trail?.steps.every(row => row.resourceName === '切削')).toBe(true);
    expect(prisma.productionScheduleResourceMaster.findMany).toHaveBeenCalledWith(expect.objectContaining({
      distinct: ['resourceCd'], orderBy: [{ resourceCd: 'asc' }, { resourceName: 'asc' }, { id: 'asc' }], take: 200
    }));
  });
  it('combines every event source, current shelves, photo/device details, loose purchases, and JST newest-first dates', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([{ rowData: snapshot }] as never);
    vi.mocked(prisma.orderPlacementBranchState.findMany).mockResolvedValue([{ shelfCodeRaw: '北1', branchNo: 0 }] as never);
    vi.mocked(prisma.haizenCurrentPlacement.findMany).mockResolvedValue([{ shelfCodeRaw: '南1' }] as never);
    vi.mocked(prisma.orderPlacementEvent.findMany).mockResolvedValue([0, 2].map(branchNo => ({ id: String(branchNo), placedAt: at,
      shelfCodeRaw: '北1', branchNo, clientDevice: { name: 'スマホA' }, mobileScanFrames: branchNo ? [] : [{ id: 'photo' }], scheduleSnapshot: snapshot })) as never);
    vi.mocked(prisma.mobileSlipVerifyRecord.findMany).mockResolvedValue(['match', 'mismatch', 'not_found', 'error'].map((outcome, index) => ({
      id: String(index), outcome, reason: outcome === 'mismatch' ? 'different_seiban' : null,
      actualResolvedFseiban: 'FS2', actualOrderBarcodeRaw: '4501238876', clientDevice: { name: 'スマホB' }, verifiedAt: new Date('2026-10-28T16:00:00Z')
    })) as never);
    vi.mocked(prisma.productionScheduleFkojunstMailStatus.findMany).mockResolvedValue([{ id: 'status', fkoteicd: 'R1', fkojun: '2', statusCode: 'S', sourceUpdatedAt: new Date('2026-10-28T14:59:59Z') }] as never);
    vi.mocked(prisma.productionScheduleActualHoursCanonical.findMany).mockResolvedValue([{ id: 'actual', resourceCd: 'R1', processOrder: 2, actualMinutes: 45.5, workDate: at }] as never);
    vi.mocked(prisma.machinePalletEvent.findMany).mockResolvedValue([{ id: 'pallet', resourceCd: 'R1', palletNo: 3, actionType: 'SET_ITEM', createdAt: at, scheduleSnapshot: snapshot }] as never);
    vi.mocked(prisma.haizenScanEvent.findMany).mockResolvedValue([{ id: 'zero', presetShelfCodeRaw: '南1', createdAt: at, scheduleSnapshot: snapshot }] as never);
    vi.mocked(prisma.purchaseOrderLookupRow.findMany).mockResolvedValue([{ id: 'purchase', purchaseStatus: 'C', sourceUpdatedAt: at }] as never);
    vi.mocked(prisma.productionScheduleResourceMaster.findMany).mockResolvedValue([{ resourceCd: 'R1', resourceName: '切削' }] as never);
    const trail = (await getHaizenOrderTrail(order))!;
    expect(trail.currentShelves).toEqual([{ shelfCodeRaw: '北1', branchNo: 0 }, { shelfCodeRaw: '南1', branchNo: null }]);
    expect(trail.events.map(row => row.id)).toEqual(['照合:0', '照合:1', '照合:2', '照合:3', 'Zero2W:zero', 'パレット:pallet', '棚:0', '棚:2', '工程:hours:actual', '購買:purchase', '工程:status:status']);
    expect(trail.events.find(row => row.id === '棚:0')).toMatchObject({ title: '北1 に置いた', detail: '分配なし · スマホA · 写真あり', processOrder: '2', date: '2026-10-29', at: at.toISOString(), loose: false });
    expect(trail.events.find(row => row.id === '棚:2')?.detail).toBe('分配2 · スマホA');
    expect(trail.events.filter(row => row.source === '照合').map(row => [row.title, row.detail])).toEqual([
      ['照合 一致', 'スマホB · 現品票 4501238876'], ['照合 不一致', 'スマホB · 別の製番 FS2'],
      ['照合できませんでした', 'スマホB · 現品票 4501238876'], ['照合できませんでした', 'スマホB · 現品票 4501238876']
    ]);
    expect(trail.events.find(row => row.id === '工程:status:status')).toMatchObject({ title: '切削 現場着手', detail: '状態の更新', processOrder: '2', date: '2026-10-28' });
    expect(trail.events.find(row => row.id === '工程:hours:actual')).toMatchObject({ title: '切削 実績', detail: '実績 45.5分', processOrder: '2', at: null });
    expect(trail.events.find(row => row.id === 'パレット:pallet')?.title).toBe('切削 パレット3 に積んだ');
    expect(trail.events.find(row => row.id === 'Zero2W:zero')).toMatchObject({ title: '南1 を読んだ', detail: '棚スキャナ' });
    expect(trail.events.find(row => row.id === '購買:purchase')).toMatchObject({ title: '全数入荷済', detail: '製番 FS1 · 品番 MD1(A)-002 の注文', loose: true, at: null, processOrder: null });
    expect(prisma.purchaseOrderLookupRow.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { seiban: 'FS1', purchasePartCodeMatchKey: 'MD1' } }));
    expect(prisma.productionScheduleActualHoursCanonical.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ lotNo: order, isExcluded: false }) }));
    expect(prisma.orderPlacementEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ mobileScanFrames: { where: { kind: 'placement_photo' }, select: { id: true }, take: 1 } }) }));
    for (const model of Object.values(prisma)) {
      for (const [query] of vi.mocked(model.findMany).mock.calls) expect(query).toHaveProperty('take', 200);
    }
  });
  it('keeps an event-only order and falls back to resource codes for every pallet action', async () => {
    const actions = ['SET_ITEM', 'REPLACE_ITEM', 'DELETE_ITEM', 'CLEAR_PALLET', 'UPSERT_ILLUSTRATION', 'DELETE_ILLUSTRATION'];
    vi.mocked(prisma.machinePalletEvent.findMany).mockResolvedValue(actions.map((actionType, id) => ({ id: String(id), actionType, resourceCd: 'UNKNOWN', palletNo: 1, createdAt: at })) as never);
    const trail = (await getHaizenOrderTrail(order))!;
    expect(trail.steps).toEqual([]);
    expect(trail.events.map(row => row.title)).toEqual(['UNKNOWN パレット1 に積んだ', 'UNKNOWN パレット1 の品物を入れ替えた', 'UNKNOWN パレット1 から降ろした', 'UNKNOWN パレット1 を空にした', 'UNKNOWN パレット1 のイラストを更新した', 'UNKNOWN パレット1 のイラストを削除した']);
    expect(prisma.purchaseOrderLookupRow.findMany).not.toHaveBeenCalled();
  });
  it('maps purchase statuses and uses updatedAt when source date is absent', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([{ rowData: snapshot }] as never);
    vi.mocked(prisma.purchaseOrderLookupRow.findMany).mockResolvedValue(['S', 'R', 'O', 'P', 'X', null].map((purchaseStatus, id) => ({ id: String(id), purchaseStatus, sourceUpdatedAt: null, updatedAt: at })) as never);
    const trail = (await getHaizenOrderTrail(order))!;
    expect(trail.steps[0].resourceName).toBe('R1');
    expect(trail.events.map(row => row.title)).toEqual(['一部入荷済', '注文済・納入なし', '未発注', '未発注', '工程削除', '購買状況未登録']);
    expect(trail.events.every(row => row.loose && row.at === null && row.date === '2026-10-29')).toBe(true);
  });
});
