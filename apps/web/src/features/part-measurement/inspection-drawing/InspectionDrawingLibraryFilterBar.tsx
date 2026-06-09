import clsx from 'clsx';
import { useMemo } from 'react';

import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { formatResourceCdWithJapaneseNames } from '../../kiosk/leaderOrderBoard/formatResourceCdWithJapaneseNames';

import {
  inspectionDrawingLibraryFilterFieldLabelClassName,
  inspectionDrawingLibraryFilterFhincdWidthClass
} from './inspectionDrawingKioskUi';
import { InspectionDrawingResourceCdSelect } from './InspectionDrawingResourceCdSelect';

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
  onRefresh: () => void;
  refreshBusy?: boolean;
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
  onRefresh,
  refreshBusy = false
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
    <div className="flex min-w-0 flex-col gap-3 rounded border border-white/15 bg-slate-900/60 p-2 sm:flex-row sm:flex-wrap sm:items-end">
      <label
        className={clsx(
          'shrink-0',
          inspectionDrawingLibraryFilterFieldLabelClassName,
          inspectionDrawingLibraryFilterFhincdWidthClass
        )}
      >
        品番
        <Input
          value={fhincd}
          onChange={(e) => onFhincdChange(e.target.value)}
          className="h-11 text-[1.08rem] text-slate-900"
          placeholder="例: ABC（部分一致）"
        />
      </label>

      <label
        className={clsx(
          'shrink-0',
          inspectionDrawingLibraryFilterFieldLabelClassName,
          inspectionDrawingLibraryFilterFhincdWidthClass
        )}
      >
        図面名
        <Input
          value={visualName}
          onChange={(e) => onVisualNameChange(e.target.value)}
          className="h-11 text-[1.08rem] text-slate-900"
          placeholder="図面名で検索"
          aria-label="図面名で検索"
        />
      </label>

      <InspectionDrawingResourceCdSelect
        value={resourceCd}
        onChange={onResourceCdChange}
        options={resourceSelectOptions}
        emptyOptionLabel="すべて"
        widthVariant="library"
      />

      <div className="grid w-full shrink-0 gap-1 sm:w-auto">
        <span className="text-[1rem] font-semibold">工程</span>
        <div className="flex flex-nowrap gap-2">
          {PROCESS_FILTER_OPTIONS.map(([value, label]) => (
            <Button
              key={value}
              type="button"
              variant={processFilter === value ? 'primary' : 'ghostOnDark'}
              className={clsx('min-h-11 shrink-0 px-3 text-[1rem]', processFilter !== value && 'opacity-80')}
              onClick={() => onProcessFilterChange(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <label className="flex shrink-0 items-center gap-2 whitespace-nowrap pb-1 text-[1rem] font-semibold text-white/90 sm:pb-1">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(e) => onIncludeInactiveChange(e.target.checked)}
          className="h-5 w-5 shrink-0"
        />
        履歴を含む
      </label>

      <div className="flex w-full shrink-0 items-end justify-start sm:ml-auto sm:w-auto">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 min-w-[7rem] text-[1.02rem]"
          onClick={onRefresh}
          disabled={refreshBusy}
        >
          {refreshBusy ? '取得中…' : '更新'}
        </Button>
      </div>
    </div>
  );
}
