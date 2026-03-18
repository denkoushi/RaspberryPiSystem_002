import { PillButton } from '../layout/PillButton';

import type { ReactNode } from 'react';

type ResourceColorClasses = {
  border: string;
  bgStrong: string;
  bgSoft: string;
  text: string;
};

type ProductionScheduleResourceFiltersProps = {
  resourceCds: string[];
  normalizedResourceCds: string[];
  normalizedAssignedOnlyCds: string[];
  getColorClasses: (resourceCd: string) => ResourceColorClasses;
  onToggleResourceCd: (resourceCd: string) => void;
  onToggleAssignedOnlyCd: (resourceCd: string) => void;
  getResourceAriaLabel: (resourceCd: string, suffix?: string) => string;
  rightActions?: ReactNode;
};

export function ProductionScheduleResourceFilters({
  resourceCds,
  normalizedResourceCds,
  normalizedAssignedOnlyCds,
  getColorClasses,
  onToggleResourceCd,
  onToggleAssignedOnlyCd,
  getResourceAriaLabel,
  rightActions
}: ProductionScheduleResourceFiltersProps) {
  return (
    <div className="flex w-full items-start gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pr-4">
          {resourceCds.map((resourceCd) => {
            const colorClasses = getColorClasses(resourceCd);
            const isActive = normalizedResourceCds.includes(resourceCd);
            const isAssignedActive = normalizedAssignedOnlyCds.includes(resourceCd);
            return (
              <div key={resourceCd} className="flex items-center gap-1 whitespace-nowrap">
                <PillButton
                  onClick={() => onToggleResourceCd(resourceCd)}
                  className={`${colorClasses.border} ${
                    isActive ? colorClasses.bgStrong : colorClasses.bgSoft
                  } ${colorClasses.text}`}
                  aria-label={getResourceAriaLabel(resourceCd)}
                >
                  {resourceCd}
                </PillButton>
                <PillButton
                  onClick={() => onToggleAssignedOnlyCd(resourceCd)}
                  className={`${colorClasses.border} ${
                    isAssignedActive ? colorClasses.bgStrong : colorClasses.bgSoft
                  } ${colorClasses.text}`}
                  aria-label={getResourceAriaLabel(resourceCd, '割当')}
                >
                  {resourceCd} 割当
                </PillButton>
              </div>
            );
          })}
        </div>
      </div>
      {rightActions ? <div className="flex shrink-0 flex-col gap-2">{rightActions}</div> : null}
    </div>
  );
}
