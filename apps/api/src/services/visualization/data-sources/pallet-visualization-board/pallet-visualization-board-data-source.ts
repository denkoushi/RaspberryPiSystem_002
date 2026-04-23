import type { DataSource } from '../data-source.interface.js';
import type { PalletBoardVisualizationData, VisualizationData } from '../../visualization.types.js';
import { queryPalletVisualizationBoard } from '../../../pallet-visualization/pallet-visualization-query.service.js';

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

export class PalletVisualizationBoardDataSource implements DataSource {
  readonly type = 'pallet_visualization_board';

  async fetchData(_config: Record<string, unknown>): Promise<VisualizationData> {
    void _config;
    const board = await queryPalletVisualizationBoard();
    const machines: PalletBoardVisualizationData['machines'] = board.machines.map((m) => ({
      machineCd: m.machineCd,
      machineName: m.machineName,
      illustrationUrl: m.illustrationUrl,
      pallets: m.pallets.map((p) => ({
        palletNo: p.palletNo,
        lines: p.items.map((it) => buildLine(it)),
      })),
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
