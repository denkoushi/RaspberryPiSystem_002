import type { PalletVizListItem } from './palletVizListItem';
import type { PalletVisualizationItemDto } from '../../../api/client';


export function mapPalletVisualizationDtoToListItem(dto: PalletVisualizationItemDto): PalletVizListItem {
  return {
    id: dto.id,
    palletNo: dto.palletNo,
    fhincd: dto.fhincd,
    fhinmei: dto.fhinmei,
    fseiban: dto.fseiban,
    machineName: dto.machineName,
    machineNameDisplay: dto.machineNameDisplay,
    plannedStartDateDisplay: dto.plannedStartDateDisplay,
    plannedQuantity: dto.plannedQuantity,
    outsideDimensionsDisplay: dto.outsideDimensionsDisplay,
  };
}
