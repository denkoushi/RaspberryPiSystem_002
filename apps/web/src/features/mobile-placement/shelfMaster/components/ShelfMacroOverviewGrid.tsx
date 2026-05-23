import { MACRO_ZONE_CATALOG } from '@raspi-system/shelf-layout-core';

import { shelfMasterTheme } from '../theme/shelfMasterTheme';

import { ShelfMacroZoneCard } from './ShelfMacroZoneCard';

import type { ShelfLayoutSummaryDto } from '../../../../api/client';
import type { MacroZoneId } from '@raspi-system/shelf-layout-core';

type Props = {
  zonesById: Map<string, ShelfLayoutSummaryDto>;
  overviewMode: 'layout' | 'relocate';
  showEditButton: boolean;
  onEditZone: (id: MacroZoneId) => void;
  onRelocateZone: (id: MacroZoneId) => void;
};

export function ShelfMacroOverviewGrid({
  zonesById,
  overviewMode,
  showEditButton,
  onEditZone,
  onRelocateZone
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <div className={shelfMasterTheme.macroOverviewGrid}>
        {MACRO_ZONE_CATALOG.map((z) => {
          const zone = zonesById.get(z.id) ?? {
            macroZoneId: z.id,
            displayName: z.displayName,
            gridSize: 3,
            shelfCount: 0,
            machineCount: 0,
            entities: []
          };
          return (
            <ShelfMacroZoneCard
              key={z.id}
              zone={zone}
              overviewMode={overviewMode}
              showEditButton={showEditButton}
              onEdit={() => onEditZone(z.id)}
              onOpenRelocate={() => onRelocateZone(z.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
