import { prisma } from '../../../lib/prisma.js';
import { parseStructuredShelfCode } from '../../mobile-placement/mobile-placement-registered-shelves.service.js';
import { fetchSeibanProgressRows } from '../../production-schedule/seiban-progress.service.js';
import { buildPartDisplayName, machineTypeDisplayKey, seibanHead5 } from './normalizers.js';
import {
  PARTS_SHELF_ZONE_DIR_LABEL,
  shelfEntryToZoneId,
  type PartsShelfZoneId,
} from './shelf-zone-map.js';
import type { PartsShelfGridViewModel, PartsShelfRowVm, PartsShelfZoneVm } from './parts-shelf-view-model.js';

const ZONE_ORDER: PartsShelfZoneId[] = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'];

const DEFAULT_MAX_ITEMS_PER_ZONE = 12;

function readRowData(
  rowData: Record<string, unknown> | null | undefined,
  scheduleSnapshot: Record<string, unknown> | null | undefined
): { fhinmei: string; fhincd: string; fseiban: string; productNo: string } {
  const rd = rowData ?? {};
  const snap = scheduleSnapshot ?? {};
  const get = (k: string) => String((rd as Record<string, unknown>)[k] ?? (snap as Record<string, unknown>)[k] ?? '').trim();
  return {
    fhinmei: get('FHINMEI'),
    fhincd: get('FHINCD'),
    fseiban: get('FSEIBAN'),
    productNo: get('ProductNo'),
  };
}

/**
 * OrderPlacementBranchState を 9 ゾーンに集約し、表示用 view model を構築する。
 */
export async function buildMobilePlacementPartsShelfGridViewModel(
  maxItemsPerZone: number = DEFAULT_MAX_ITEMS_PER_ZONE
): Promise<PartsShelfGridViewModel> {
  const cap = Number.isFinite(maxItemsPerZone) && maxItemsPerZone > 0 ? Math.min(200, Math.floor(maxItemsPerZone)) : DEFAULT_MAX_ITEMS_PER_ZONE;

  const states = await prisma.orderPlacementBranchState.findMany({
    orderBy: [{ updatedAt: 'desc' }],
  });

  const csvIds = [...new Set(states.map((s) => s.csvDashboardRowId).filter((id): id is string => id != null && id.length > 0))];

  const csvRows =
    csvIds.length > 0
      ? await prisma.csvDashboardRow.findMany({
          where: { id: { in: csvIds } },
        })
      : [];

  const csvById = new Map(csvRows.map((r) => [r.id, r]));

  const buckets = new Map<PartsShelfZoneId, PartsShelfRowVm[]>();
  for (const z of ZONE_ORDER) {
    buckets.set(z, []);
  }

  type PendingPlacement = { zoneId: PartsShelfZoneId; fields: ReturnType<typeof readRowData> };
  const pending: PendingPlacement[] = [];
  const fseibanKeys = new Set<string>();

  for (const st of states) {
    const parsed = parseStructuredShelfCode(st.shelfCodeRaw);
    const zoneId = shelfEntryToZoneId(parsed);
    if (!zoneId) {
      continue;
    }

    const csvRow = st.csvDashboardRowId ? csvById.get(st.csvDashboardRowId) : undefined;
    const rd = csvRow?.rowData as Record<string, unknown> | undefined;
    const snap = st.scheduleSnapshot as Record<string, unknown> | undefined;
    const fields = readRowData(rd, snap);
    const fs = fields.fseiban.trim();
    if (fs.length > 0) {
      fseibanKeys.add(fs);
    }
    pending.push({ zoneId, fields });
  }

  /** 機種名: ProductNo は製造order用途のため使わない。MH/SH 行 FHINMEI 集約（部品検索・進捗一覧と同系） */
  const progressRows = await fetchSeibanProgressRows([...fseibanKeys]);
  const machineBySeiban = new Map(
    progressRows.map((r) => [r.fseiban.trim(), (r.machineName ?? '').trim()])
  );

  for (const { zoneId, fields } of pending) {
    const partName = buildPartDisplayName(fields);
    const machineSchedule = machineBySeiban.get(fields.fseiban.trim()) ?? '';
    const machine10 = machineTypeDisplayKey(machineSchedule);
    const serial5 = seibanHead5(fields.fseiban);

    const row: PartsShelfRowVm = {
      serial5,
      partName,
      machine10,
    };

    const list = buckets.get(zoneId);
    if (list) {
      list.push(row);
    }
  }

  const zones: PartsShelfZoneVm[] = ZONE_ORDER.map((zoneId) => {
    const all = buckets.get(zoneId) ?? [];
    const totalCount = all.length;
    const slice = all.slice(0, cap);
    const omittedCount = Math.max(0, totalCount - slice.length);
    return {
      zoneId,
      dirLabel: PARTS_SHELF_ZONE_DIR_LABEL[zoneId],
      rows: slice,
      totalCount,
      omittedCount,
    };
  });

  return { zones };
}
