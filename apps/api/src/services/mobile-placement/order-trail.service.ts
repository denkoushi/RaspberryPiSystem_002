import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../production-schedule/seiban-machine-display-names.service.js';
import { normalizePurchaseFhinCdForMatching } from '../purchase-order-lookup/purchase-fhincd-normalize.js';

import type { MachinePalletEventActionType, Prisma } from '@prisma/client';

export type HaizenOrderTrail = {
  orderNo: string; fhinmei: string; machineName: string; fseiban: string; fhincd: string;
  currentShelves: { shelfCodeRaw: string; branchNo: number | null }[];
  steps: { processOrder: string; resourceName: string; status: string; tone: 'done' | 'active' | 'waiting' | 'none' }[];
  events: {
    id: string; at: string | null; date: string;
    source: '棚' | '照合' | '工程' | 'パレット' | 'Zero2W' | '購買';
    processOrder: string | null; title: string; detail: string | null; loose: boolean;
  }[];
};
type TrailEvent = HaizenOrderTrail['events'][number];
const LIMIT = 200;
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
const localDay = (date: Date) => dayFormatter.format(date);
const field = (row: Prisma.JsonValue | undefined, key: string): string => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return '';
  const value = row[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
};
const processOrder = (row: Prisma.JsonValue | undefined) => field(row, 'FKOJUN') || null;

function status(code?: string): Pick<HaizenOrderTrail['steps'][number], 'status' | 'tone'> {
  switch (code) {
    case 'C': return { status: '加工完了', tone: 'done' };
    case 'S': return { status: '現場着手', tone: 'active' };
    case 'R': return { status: '移動票発行', tone: 'waiting' };
    case 'X': return { status: '外注', tone: 'waiting' };
    default: return { status: '未確定', tone: 'none' };
  }
}

function event(source: TrailEvent['source'], id: string, date: Date, title: string, detail: string | null,
  order: string | null = null, dateOnly = false): TrailEvent {
  return { id: `${source}:${id}`, source, date: localDay(date), at: dateOnly ? null : date.toISOString(),
    processOrder: order, title, detail, loose: false };
}

async function resourceNames(codes: string[]) {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return new Map<string, string>();
  // Distinct plus name ordering picks the same name when a code has several master rows.
  const rows = await prisma.productionScheduleResourceMaster.findMany({
    where: { resourceCd: { in: unique } }, distinct: ['resourceCd'],
    orderBy: [{ resourceCd: 'asc' }, { resourceName: 'asc' }, { id: 'asc' }],
    select: { resourceCd: true, resourceName: true }, take: LIMIT
  });
  return new Map(rows.map(row => [row.resourceCd, row.resourceName]));
}

async function readSchedule(order: string) {
  const rows = await prisma.csvDashboardRow.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, rowData: { path: ['ProductNo'], equals: order } },
    select: { rowData: true, fkojunstMailStatus: { select: { statusCode: true } },
      fkojunstStatus: { select: { statusCode: true } }, productionScheduleProgress: { select: { isCompleted: true } } },
    orderBy: { id: 'asc' }, take: LIMIT
  });
  const names = await resourceNames(rows.map(row => field(row.rowData, 'FSIGENCD')));
  const steps = new Map<string, HaizenOrderTrail['steps'][number]>();
  for (const row of rows) {
    const orderNo = processOrder(row.rowData);
    if (!orderNo || steps.has(orderNo)) continue;
    const resourceCd = field(row.rowData, 'FSIGENCD');
    const code = row.fkojunstMailStatus?.statusCode ?? row.fkojunstStatus?.statusCode
      ?? (row.productionScheduleProgress?.isCompleted ? 'C' : undefined);
    steps.set(orderNo, { processOrder: orderNo, resourceName: names.get(resourceCd) || resourceCd, ...status(code) });
  }
  return { rows, steps: [...steps.values()].sort((a, b) => Number(a.processOrder) - Number(b.processOrder) || a.processOrder.localeCompare(b.processOrder)) };
}

async function readCurrentShelves(order: string) {
  const where = { manufacturingOrderBarcodeRaw: order };
  const [branches, zero2w] = await Promise.all([
    prisma.orderPlacementBranchState.findMany({ where, orderBy: [{ branchNo: 'asc' }, { id: 'asc' }], take: LIMIT,
      select: { shelfCodeRaw: true, branchNo: true, scheduleSnapshot: true } }),
    prisma.haizenCurrentPlacement.findMany({ where, orderBy: { id: 'asc' }, take: LIMIT,
      select: { shelfCodeRaw: true, scheduleSnapshot: true } })
  ]);
  return [...branches, ...zero2w.map(row => ({ ...row, branchNo: null }))];
}

async function shelfEvents(order: string): Promise<TrailEvent[]> {
  const rows = await prisma.orderPlacementEvent.findMany({
    where: { manufacturingOrderBarcodeRaw: order }, orderBy: [{ placedAt: 'desc' }, { id: 'asc' }], take: LIMIT,
    include: { clientDevice: { select: { name: true } },
      mobileScanFrames: { where: { kind: 'placement_photo' }, select: { id: true }, take: 1 } }
  });
  return rows.map(row => event('棚', row.id, row.placedAt, `${row.shelfCodeRaw} に置いた`,
    [row.branchNo === 0 ? '分配なし' : `分配${row.branchNo}`, row.clientDevice.name,
      row.mobileScanFrames.length ? '写真あり' : null].filter(Boolean).join(' · '), processOrder(row.scheduleSnapshot)));
}

async function verifyEvents(order: string): Promise<TrailEvent[]> {
  const rows = await prisma.mobileSlipVerifyRecord.findMany({
    where: { transferOrderBarcodeRaw: order }, include: { clientDevice: { select: { name: true } } },
    orderBy: [{ verifiedAt: 'desc' }, { id: 'asc' }], take: LIMIT
  });
  return rows.map(row => {
    const otherSeiban = row.actualResolvedFseiban || row.actualFseibanRaw;
    const slip = row.reason === 'different_seiban' && otherSeiban ? `別の製番 ${otherSeiban}`
      : row.actualOrderBarcodeRaw ? `現品票 ${row.actualOrderBarcodeRaw}` : null;
    const title = row.outcome === 'match' ? '照合 一致' : row.outcome === 'mismatch' ? '照合 不一致' : '照合できませんでした';
    return event('照合', row.id, row.verifiedAt, title, [row.clientDevice.name, slip].filter(Boolean).join(' · '));
  });
}

async function mailStatusEvents(order: string): Promise<TrailEvent[]> {
  const rows = await prisma.productionScheduleFkojunstMailStatus.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fsezono: order },
    orderBy: [{ sourceUpdatedAt: 'desc' }, { id: 'asc' }], take: LIMIT
  });
  const names = await resourceNames(rows.map(row => row.fkoteicd));
  return rows.map(row => event('工程', `status:${row.id}`, row.sourceUpdatedAt,
    `${names.get(row.fkoteicd) || row.fkoteicd} ${status(row.statusCode).status}`, '状態の更新', row.fkojun));
}

async function actualHoursEvents(order: string): Promise<TrailEvent[]> {
  const rows = await prisma.productionScheduleActualHoursCanonical.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, lotNo: order, isExcluded: false },
    orderBy: [{ workDate: 'desc' }, { id: 'asc' }], take: LIMIT
  });
  const names = await resourceNames(rows.map(row => row.resourceCd));
  return rows.map(row => event('工程', `hours:${row.id}`, row.workDate,
    `${names.get(row.resourceCd) || row.resourceCd} 実績`, `実績 ${row.actualMinutes}分`,
    row.processOrder == null ? null : String(row.processOrder), true));
}

const palletActions: Record<MachinePalletEventActionType, string> = {
  SET_ITEM: 'に積んだ', REPLACE_ITEM: 'の品物を入れ替えた', DELETE_ITEM: 'から降ろした',
  CLEAR_PALLET: 'を空にした', UPSERT_ILLUSTRATION: 'のイラストを更新した', DELETE_ILLUSTRATION: 'のイラストを削除した'
};
async function palletEvents(order: string): Promise<TrailEvent[]> {
  const rows = await prisma.machinePalletEvent.findMany({
    where: { manufacturingOrderBarcodeRaw: order }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: LIMIT
  });
  const names = await resourceNames(rows.map(row => row.resourceCd));
  return rows.map(row => event('パレット', row.id, row.createdAt,
    `${names.get(row.resourceCd) || row.resourceCd}${row.palletNo == null ? '' : ` パレット${row.palletNo}`} ${palletActions[row.actionType]}`,
    null, processOrder(row.scheduleSnapshot)));
}

async function zero2wEvents(order: string): Promise<TrailEvent[]> {
  const rows = await prisma.haizenScanEvent.findMany({
    where: { manufacturingOrderBarcodeRaw: order }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: LIMIT
  });
  return rows.map(row => event('Zero2W', row.id, row.createdAt, `${row.presetShelfCodeRaw} を読んだ`, '棚スキャナ', processOrder(row.scheduleSnapshot)));
}

async function purchaseEvents(fseiban: string, fhincd: string): Promise<TrailEvent[]> {
  const matchKey = normalizePurchaseFhinCdForMatching(fhincd);
  if (!fseiban || !matchKey) return [];
  const rows = await prisma.purchaseOrderLookupRow.findMany({
    where: { seiban: fseiban, purchasePartCodeMatchKey: matchKey },
    orderBy: [{ sourceUpdatedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }], take: LIMIT
  });
  const titles: Record<string, string> = { C: '全数入荷済', S: '一部入荷済', R: '注文済・納入なし', O: '未発注', P: '未発注', X: '工程削除' };
  return rows.map(row => ({ ...event('購買', row.id, row.sourceUpdatedAt ?? row.updatedAt,
    titles[row.purchaseStatus ?? ''] ?? '購買状況未登録', `製番 ${fseiban} · 品番 ${fhincd} の注文`, null, true), loose: true }));
}

export async function getHaizenOrderTrail(order: string): Promise<HaizenOrderTrail | null> {
  const [schedule, shelves] = await Promise.all([readSchedule(order), readCurrentShelves(order)]);
  const snapshot = schedule.rows[0]?.rowData ?? shelves.find(row => row.scheduleSnapshot)?.scheduleSnapshot;
  const fseiban = field(snapshot, 'FSEIBAN');
  const fhincd = field(snapshot, 'FHINCD');
  const sources = await Promise.all([shelfEvents(order), verifyEvents(order), mailStatusEvents(order),
    actualHoursEvents(order), palletEvents(order), zero2wEvents(order), purchaseEvents(fseiban, fhincd)]);
  const events = sources.flat().sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? '').localeCompare(a.at ?? '') || a.id.localeCompare(b.id));
  if (!schedule.rows.length && !shelves.length && !events.length) return null;
  const { machineNames } = await resolveSeibanMachineDisplayNamesBatched(fseiban ? [fseiban] : []);
  return { orderNo: order, fhinmei: field(snapshot, 'FHINMEI'), fseiban, fhincd, machineName: machineNames[fseiban] ?? '',
    currentShelves: shelves.map(({ shelfCodeRaw, branchNo }) => ({ shelfCodeRaw, branchNo })), steps: schedule.steps, events };
}
