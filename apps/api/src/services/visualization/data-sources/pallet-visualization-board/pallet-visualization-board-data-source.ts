import type { DataSource } from '../data-source.interface.js';
import type { PalletBoardVisualizationData, VisualizationData } from '../../visualization.types.js';
import { queryPalletVisualizationBoard } from '../../../pallet-visualization/pallet-visualization-query.service.js';
import { parsePalletBoardMachineCdsFromConfig } from './pallet-visualization-board-config.js';

function buildLine(item: {
  fhincd: string;
  fhinmei: string;
  fseiban: string;
  machineName: string | null;
  machineNameDisplay: string | null;
}): string {
  const mn = (item.machineNameDisplay ?? item.machineName)?.trim();
  const tail = mn ? `${item.fseiban} / ${mn}` : item.fseiban;
  return `${item.fhincd} ${item.fhinmei}（${tail}）`;
}

function mapPrimaryFromItem(first: {
  fhincd: string;
  fhinmei: string;
  fseiban: string;
  machineNameDisplay: string | null;
  plannedStartDateDisplay: string | null;
  plannedQuantity: number | null;
}): {
  fhincd: string;
  fhinmei: string;
  fseiban: string;
  machineNameDisplay: string | null;
  plannedStartDateDisplay: string | null;
  plannedQuantity: number | null;
} {
  return {
    fhincd: first.fhincd,
    fhinmei: first.fhinmei,
    fseiban: first.fseiban,
    machineNameDisplay: first.machineNameDisplay,
    plannedStartDateDisplay: first.plannedStartDateDisplay,
    plannedQuantity: first.plannedQuantity,
  };
}

export class PalletVisualizationBoardDataSource implements DataSource {
  readonly type = 'pallet_visualization_board';

  async fetchData(config: Record<string, unknown>): Promise<VisualizationData> {
    const machineCds = parsePalletBoardMachineCdsFromConfig(config);
    const board = await queryPalletVisualizationBoard(machineCds ? { machineCds } : undefined);
    const machines: PalletBoardVisualizationData['machines'] = board.machines.map((m) => ({
      machineCd: m.machineCd,
      machineName: m.machineName,
      illustrationUrl: m.illustrationUrl,
      pallets: m.pallets.map((p) => {
        const ordered = [...p.items].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
        const first = ordered[0];
        const second = ordered[1];
        return {
          palletNo: p.palletNo,
          lines: p.items.map((it) => buildLine(it)),
          isEmpty: p.items.length === 0,
          primaryItem: first !== undefined ? mapPrimaryFromItem(first) : undefined,
          secondaryItem: second !== undefined ? mapPrimaryFromItem(second) : undefined,
        };
      }),
    }));

    return {
      kind: 'pallet_board',
      machines,
      metadata: {
        totalMachines: machines.length,
        generatedAt: new Date().toISOString(),
      },
    };
  }
}
