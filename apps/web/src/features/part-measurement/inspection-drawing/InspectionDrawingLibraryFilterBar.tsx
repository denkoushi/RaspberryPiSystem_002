import clsx from 'clsx';
import { useMemo } from 'react';

import { Button } from '../../../components/ui/Button';
import {
  kioskButtonSecondaryClassName,
  kioskInputClassName,
  kioskSelectClassName
} from '../../../features/kiosk/kioskTheme';
import { formatResourceCdWithJapaneseNames } from '../../kiosk/leaderOrderBoard/formatResourceCdWithJapaneseNames';

import { inspectionDrawingBoundedSelectClassName } from './inspectionDrawingKioskUi';

import type { PartMeasurementProcessGroup } from '../types';

export type InspectionDrawingLibraryProcessFilter = PartMeasurementProcessGroup | 'all';

const PROCESS_FILTER_OPTIONS: ReadonlyArray<readonly [InspectionDrawingLibraryProcessFilter, string]> = [
  ['all', 'すべて'],
  ['cutting', '切削'],
  ['grinding', '研削']
];

type Props = {
  fhincd: string;
  onFhincdChange: (value: string) => void;
  visualName: string;
  onVisualNameChange: (value: string) => void;
  resourceCd: string;
  onResourceCdChange: (value: string) => void;
  resourceOptions: string[];
  resourceNameMap: Record<string, string[]>;
  processFilter: InspectionDrawingLibraryProcessFilter;
  onProcessFilterChange: (value: InspectionDrawingLibraryProcessFilter) => void;
  includeInactive: boolean;
  onIncludeInactiveChange: (value: boolean) => void;
  onReload: () => void;
  onReset: () => void;
  resetDisabled: boolean;
  busy?: boolean;
};

/**
 * 検査図面一覧フィルタ。
 * 固定列数の grid は長い資源表示名で工程列と重なるため、flex-wrap + 明示幅で配置する。
 */
export function InspectionDrawingLibraryFilterBar({
  fhincd,
  onFhincdChange,
  visualName,
  onVisualNameChange,
  resourceCd,
  onResourceCdChange,
  resourceOptions,
  resourceNameMap,
  processFilter,
  onProcessFilterChange,
  includeInactive,
  onIncludeInactiveChange,
  onReload,
  onReset,
  resetDisabled,
  busy = false
}: Props) {
  const resourceSelectOptions = useMemo(
    () =>
      resourceOptions.map((cd) => ({
        value: cd,
        label: formatResourceCdWithJapaneseNames(cd, resourceNameMap)
      })),
    [resourceNameMap, resourceOptions]
  );

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded border border-white/10 bg-slate-900/60 px-2 py-1.5">
      <div className="w-[11rem] max-w-full shrink-0">
        <input
          value={fhincd}
          onChange={(e) => onFhincdChange(e.target.value)}
          className={clsx(kioskInputClassName, 'h-11 w-full text-sm')}
          placeholder="品番"
          aria-label="品番"
        />
      </div>

      <div className="w-[13rem] max-w-full shrink-0">
        <input
          value={visualName}
          onChange={(e) => onVisualNameChange(e.target.value)}
          className={clsx(kioskInputClassName, 'h-11 w-full text-sm')}
          placeholder="図面名"
          aria-label="図面名で検索"
        />
      </div>

      <div className="w-[19rem] max-w-full shrink-0 overflow-hidden rounded-md">
        <select
          value={resourceCd}
          aria-label="資源CD"
          onChange={(e) => onResourceCdChange(e.target.value)}
          className={clsx(inspectionDrawingBoundedSelectClassName, 'h-11 text-sm')}
        >
          <option value="">資源CD</option>
          {resourceSelectOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <select
        value={processFilter}
        aria-label="工程"
        onChange={(e) => onProcessFilterChange(e.target.value as InspectionDrawingLibraryProcessFilter)}
        className={clsx(kioskSelectClassName, 'h-11 w-[5.2rem] shrink-0 text-sm font-semibold')}
      >
        {PROCESS_FILTER_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <label className="flex shrink-0 items-center gap-1 whitespace-nowrap text-sm font-semibold text-white/90">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(e) => onIncludeInactiveChange(e.target.checked)}
          className="h-4 w-4 shrink-0"
        />
        履歴
      </label>

      <div className="ml-auto flex shrink-0 items-center justify-start gap-2">
        <button
          type="button"
          className={clsx(kioskButtonSecondaryClassName, 'min-w-[4.8rem] !px-2 !py-0 text-sm')}
          onClick={onReload}
          disabled={busy}
        >
          {busy ? '取得中…' : '再読込'}
        </button>
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-11 min-w-[4.8rem] !px-2 !py-0 text-sm"
          onClick={onReset}
          disabled={resetDisabled || busy}
        >
          リセット
        </Button>
      </div>
    </div>
  );
}
