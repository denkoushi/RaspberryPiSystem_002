import { prisma } from '../../lib/prisma.js';
import type {
  PalletVisualizationBoardResponse,
  PalletVisualizationHistoryResponse,
  PalletVisualizationItem,
  PalletVisualizationMachineResponse,
  PalletVisualizationMachineBoard,
  PalletVisualizationMachinesResponse,
  PalletVisualizationMachineSummary,
} from './pallet-visualization.types.js';
import { getResourceNameMapByResourceCds } from '../production-schedule/resource-master.service.js';
import { listRegisteredMachineCds } from './pallet-visualization-resource.service.js';
import { DEFAULT_MACHINE_PALLET_COUNT } from './pallet-count-bounds.js';
import { ApiError } from '../../lib/errors.js';
import {
  buildPalletMachineNameDisplay,
  extractOutsideDimensionsDisplay,
  formatPlannedStartDateForPalletDisplay,
  readPalletItemDisplayFromScheduleSnapshot,
} from './pallet-visualization-display-fields.js';

const normalizeCd = (value: string): string => value.trim().toUpperCase();

function toItem(row: {
  id: string;
  resourceCd: string;
  palletNo: number;
  displayOrder: number;
  fhincd: string;
  fhinmei: string;
  fseiban: string;
  machineName: string | null;
  csvDashboardRowId: string | null;
  scheduleSnapshot: unknown;
  fallbackPlannedStartDateDisplay: string | null;
  fallbackPlannedQuantity: number | null;
  fallbackOutsideDimensionsDisplay: string | null;
}): PalletVisualizationItem {
  const fromSnap = readPalletItemDisplayFromScheduleSnapshot(row.scheduleSnapshot);
  return {
    id: row.id,
    machineCd: normalizeCd(row.resourceCd),
    palletNo: row.palletNo,
    displayOrder: row.displayOrder,
    fhincd: row.fhincd,
    fhinmei: row.fhinmei,
    fseiban: row.fseiban,
    machineName: row.machineName,
    machineNameDisplay: buildPalletMachineNameDisplay(row.machineName),
    csvDashboardRowId: row.csvDashboardRowId,
    plannedStartDateDisplay: fromSnap.plannedStartDateDisplay ?? row.fallbackPlannedStartDateDisplay,
    plannedQuantity: fromSnap.plannedQuantity ?? row.fallbackPlannedQuantity,
    outsideDimensionsDisplay: fromSnap.outsideDimensionsDisplay ?? row.fallbackOutsideDimensionsDisplay,
  };
}

function buildMachineBoards(params: {
  machineCds: string[];
  nameMap: Record<string, string[]>;
  items: Array<{
    id: string;
    resourceCd: string;
    palletNo: number;
    displayOrder: number;
    fhincd: string;
    fhinmei: string;
    fseiban: string;
    machineName: string | null;
    csvDashboardRowId: string | null;
    scheduleSnapshot: unknown;
    fallbackPlannedStartDateDisplay: string | null;
    fallbackPlannedQuantity: number | null;
    fallbackOutsideDimensionsDisplay: string | null;
  }>;
  illustrations: Array<{ resourceCd: string; imageRelativeUrl: string | null; palletCount: number }>;
}): PalletVisualizationMachineBoard[] {
  const illustByCd = new Map(
    params.illustrations.map((i) => [
      normalizeCd(i.resourceCd),
      { imageRelativeUrl: i.imageRelativeUrl, palletCount: i.palletCount },
    ])
  );

  const itemsByMachine = new Map<string, PalletVisualizationItem[]>();
  for (const row of params.items) {
    const cd = normalizeCd(row.resourceCd);
    const list = itemsByMachine.get(cd) ?? [];
    list.push(toItem(row));
    itemsByMachine.set(cd, list);
  }

  return params.machineCds.map((cd) => {
    const machineName = (params.nameMap[cd] ?? [])[0] ?? cd;
    const meta = illustByCd.get(cd);
    const illustrationUrl = meta?.imageRelativeUrl ?? null;
    const palletCount = meta?.palletCount ?? DEFAULT_MACHINE_PALLET_COUNT;
    const machineItems = itemsByMachine.get(cd) ?? [];
    const palletMap = new Map<number, PalletVisualizationItem[]>();
    for (let p = 1; p <= palletCount; p += 1) {
      palletMap.set(p, []);
    }
    for (const it of machineItems) {
      const list = palletMap.get(it.palletNo) ?? [];
      list.push(it);
      palletMap.set(it.palletNo, list);
    }
    const pallets = Array.from(palletMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([palletNo, plist]) => ({
        palletNo,
        items: plist,
      }));

    return {
      machineCd: cd,
      machineName,
      illustrationUrl,
      palletCount,
      pallets,
    };
  });
}

/**
 * Intersects requested machine codes with the registered resource list, preserving **registered** sort order
 * (stable with existing “all machines” board ordering).
 */
function intersectMachineCdsWithRegistered(requested: string[], registered: string[]): string[] {
  if (requested.length === 0) {
    return [];
  }
  const wanted = new Set(requested.map((cd) => normalizeCd(cd)));
  return registered.filter((cd) => wanted.has(cd));
}

async function loadMachineBoardsForOrderedCds(filteredMachineCds: string[]): Promise<PalletVisualizationMachineBoard[]> {
  if (filteredMachineCds.length === 0) {
    return [];
  }

  const nameMap = await getResourceNameMapByResourceCds(filteredMachineCds);

  const [items, illustrations] = await Promise.all([
    prisma.machinePalletItem.findMany({
      where: { resourceCd: { in: filteredMachineCds } },
      orderBy: [{ resourceCd: 'asc' }, { palletNo: 'asc' }, { displayOrder: 'asc' }],
    }),
    prisma.palletMachineIllustration.findMany({
      where: { resourceCd: { in: filteredMachineCds } },
    }),
  ]);

  const rowIds = Array.from(new Set(items.map((item) => item.csvDashboardRowId).filter((id): id is string => Boolean(id))));
  const csvRows =
    rowIds.length > 0
      ? await prisma.csvDashboardRow.findMany({
          where: { id: { in: rowIds } },
          select: {
            id: true,
            rowData: true,
            orderSupplements: {
              take: 1,
              select: { plannedQuantity: true, plannedStartDate: true },
            },
          },
        })
      : [];
  const csvRowMap = new Map(csvRows.map((row) => [row.id, row]));
  const itemsWithFallback = items.map((item) => {
    const csvRow = item.csvDashboardRowId ? csvRowMap.get(item.csvDashboardRowId) : null;
    const rowData = (csvRow?.rowData ?? null) as Record<string, unknown> | null;
    const supplement = csvRow?.orderSupplements[0];
    return {
      ...item,
      fallbackPlannedStartDateDisplay: formatPlannedStartDateForPalletDisplay(supplement?.plannedStartDate ?? null),
      fallbackPlannedQuantity: supplement?.plannedQuantity ?? null,
      fallbackOutsideDimensionsDisplay: rowData ? extractOutsideDimensionsDisplay(rowData) : null,
    };
  });

  return buildMachineBoards({
    machineCds: filteredMachineCds,
    nameMap,
    items: itemsWithFallback,
    illustrations,
  });
}

async function queryPalletVisualizationMachineBoards(machineCd?: string): Promise<PalletVisualizationMachineBoard[]> {
  const machineCds = await listRegisteredMachineCds();
  const filteredMachineCds = machineCd
    ? machineCds.filter((cd) => cd === normalizeCd(machineCd))
    : machineCds;
  if (machineCd && filteredMachineCds.length === 0) {
    throw new ApiError(404, '加工機（資源マスタ）が登録されていません', undefined, 'PALLET_MACHINE_NOT_REGISTERED');
  }

  return loadMachineBoardsForOrderedCds(filteredMachineCds);
}

export async function queryPalletVisualizationMachines(): Promise<PalletVisualizationMachinesResponse> {
  const machines = await queryPalletVisualizationMachineBoards();
  const summaries: PalletVisualizationMachineSummary[] = machines.map((machine) => ({
    machineCd: machine.machineCd,
    machineName: machine.machineName,
    illustrationUrl: machine.illustrationUrl,
    palletCount: machine.palletCount,
  }));
  return { machines: summaries };
}

export async function queryPalletVisualizationBoard(options?: { machineCds?: string[] }): Promise<PalletVisualizationBoardResponse> {
  const registered = await listRegisteredMachineCds();
  const filteredMachineCds =
    options?.machineCds && options.machineCds.length > 0
      ? intersectMachineCdsWithRegistered(options.machineCds, registered)
      : registered;
  const machines = await loadMachineBoardsForOrderedCds(filteredMachineCds);
  return { machines };
}

export async function queryPalletVisualizationMachine(machineCd: string): Promise<PalletVisualizationMachineResponse> {
  const machines = await queryPalletVisualizationMachineBoards(machineCd);
  const machine = machines[0];
  if (!machine) {
    throw new ApiError(404, '加工機（資源マスタ）が登録されていません', undefined, 'PALLET_MACHINE_NOT_REGISTERED');
  }
  return { machine };
}

export async function queryPalletVisualizationHistory(options: {
  limit: number;
  cursor?: string | null;
}): Promise<PalletVisualizationHistoryResponse> {
  const limit = Math.min(Math.max(options.limit, 1), 200);
  const rows = await prisma.machinePalletEvent.findMany({
    take: limit + 1,
    ...(options.cursor ? { skip: 1, cursor: { id: options.cursor } } : {}),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      actionType: true,
      resourceCd: true,
      palletNo: true,
      affectedItemId: true,
      manufacturingOrderBarcodeRaw: true,
      illustrationRelativeUrl: true,
      createdAt: true,
    },
  });

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && slice.length > 0 ? slice[slice.length - 1]!.id : null;

  return {
    events: slice.map((e) => ({
      id: e.id,
      actionType: e.actionType,
      machineCd: normalizeCd(e.resourceCd),
      palletNo: e.palletNo,
      affectedItemId: e.affectedItemId,
      manufacturingOrderBarcodeRaw: e.manufacturingOrderBarcodeRaw,
      illustrationRelativeUrl: e.illustrationRelativeUrl,
      createdAt: e.createdAt.toISOString(),
    })),
    nextCursor,
  };
}
