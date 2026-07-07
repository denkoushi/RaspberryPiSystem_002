import clsx from 'clsx';

import { formatResourceCdWithJapaneseNames } from '../../kiosk/leaderOrderBoard/formatResourceCdWithJapaneseNames';

const MAX_VISIBLE_RESOURCE_CHIPS = 4;

type Props = {
  resourceCds: string[];
  resourceNameMap: Record<string, string[]>;
  testId?: string;
  className?: string;
};

export function InspectionDrawingResourceCdChipList({
  resourceCds,
  resourceNameMap,
  testId = 'inspection-template-resource-chips',
  className
}: Props) {
  const visibleResourceCds = resourceCds.slice(0, MAX_VISIBLE_RESOURCE_CHIPS);
  const hiddenResourceCount = resourceCds.length - visibleResourceCds.length;
  const resourceSummaryTitle = resourceCds
    .map((cd) => formatResourceCdWithJapaneseNames(cd, resourceNameMap))
    .join(' / ');

  return (
    <div
      className={clsx('flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden', className)}
      data-testid={testId}
      title={resourceSummaryTitle}
    >
      {visibleResourceCds.map((cd) => (
        <span
          key={cd}
          className="shrink-0 truncate rounded border border-cyan-300/35 bg-cyan-950/50 px-1.5 py-0.5 text-xs font-semibold leading-tight text-cyan-100"
          title={formatResourceCdWithJapaneseNames(cd, resourceNameMap)}
        >
          {cd}
        </span>
      ))}
      {hiddenResourceCount > 0 ? (
        <span className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-xs leading-tight text-white/70">
          +{hiddenResourceCount}
        </span>
      ) : null}
    </div>
  );
}
