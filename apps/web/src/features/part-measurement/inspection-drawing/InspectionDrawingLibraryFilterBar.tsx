import clsx from 'clsx';
import { useMemo } from 'react';

import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { formatResourceCdWithJapaneseNames } from '../../kiosk/leaderOrderBoard/formatResourceCdWithJapaneseNames';

import {
  inspectionDrawingBoundedSelectClassName,
  inspectionDrawingBoundedSelectShellClassName
} from './inspectionDrawingKioskUi';

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
      <div className="w-[7.8rem] max-w-full shrink-0">
        <Input
          value={fhincd}
          onChange={(e) => onFhincdChange(e.target.value)}
          className="h-9 w-full px-2 text-[0.9rem] text-slate-900"
          placeholder="品番"
          aria-label="品番"
        />
      </div>

      <div className="w-[8.8rem] max-w-full shrink-0">
        <Input
          value={visualName}
          onChange={(e) => onVisualNameChange(e.target.value)}
          className="h-9 w-full px-2 text-[0.9rem] text-slate-900"
          placeholder="図面名"
          aria-label="図面名で検索"
        />
      </div>

      <div className={clsx('w-[8.8rem] max-w-full shrink-0', inspectionDrawingBoundedSelectShellClassName)}>
        <select
          value={resourceCd}
          aria-label="資源CD"
          onChange={(e) => onResourceCdChange(e.target.value)}
          className={clsx(inspectionDrawingBoundedSelectClassName, 'h-9 px-2 text-[0.9rem]')}
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
        className="h-9 w-[5.2rem] shrink-0 rounded-md border-2 border-slate-500 bg-white px-2 text-[0.9rem] font-semibold text-slate-900"
      >
        {PROCESS_FILTER_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <label className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[0.88rem] font-semibold text-white/90">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(e) => onIncludeInactiveChange(e.target.checked)}
          className="h-4 w-4 shrink-0"
        />
        履歴
      </label>

      <div className="ml-auto flex shrink-0 items-center justify-start gap-2">
        <Button
          type="button"
          variant="secondary"
          className="min-h-9 min-w-[4.8rem] !px-2 !py-0 text-[0.9rem]"
          onClick={onReload}
          disabled={busy}
        >
          {busy ? '取得中…' : '再読込'}
        </Button>
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-9 min-w-[4.8rem] !px-2 !py-0 text-[0.9rem]"
          onClick={onReset}
          disabled={resetDisabled || busy}
        >
          リセット
        </Button>
      </div>
    </div>
  );
}
