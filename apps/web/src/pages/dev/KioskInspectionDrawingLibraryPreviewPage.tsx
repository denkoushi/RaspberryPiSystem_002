import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button, buttonClassName } from '../../components/ui/Button';
import { formatResourceCdWithJapaneseNames } from '../../features/kiosk/leaderOrderBoard/formatResourceCdWithJapaneseNames';
import {
  InspectionDrawingLibraryFilterBar,
  InspectionDrawingTemplateHistoryDialog,
  KIOSK_INSPECTION_DRAWING_LIBRARY_PATH,
  type InspectionDrawingLibraryProcessFilter
} from '../../features/part-measurement/inspection-drawing';
import {
  INSPECTION_DRAWING_PREVIEW_LIBRARY_TEMPLATES,
  INSPECTION_DRAWING_PREVIEW_RESOURCE_NAME_MAP
} from '../../features/part-measurement/inspection-drawing/inspectionDrawingPreviewFixtures';

import { KioskInspectionDrawingDevPreviewChrome } from './KioskInspectionDrawingDevPreviewChrome';

import type { KioskInspectionDrawingTemplateSummaryDto } from '../../features/part-measurement/types';

function processLabel(processGroup: KioskInspectionDrawingTemplateSummaryDto['processGroup']): string {
  if (processGroup === 'cutting') return '切削';
  if (processGroup === 'grinding') return '研削';
  return '—';
}

function updatedLabel(template: KioskInspectionDrawingTemplateSummaryDto): string {
  const visualUpdatedAt = template.visualTemplate?.updatedAt;
  if (!visualUpdatedAt) return '図面未設定';
  return new Date(visualUpdatedAt).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function lineageGroupKey(template: KioskInspectionDrawingTemplateSummaryDto): string {
  return `${template.fhincd}::${template.processGroup ?? 'none'}::${template.resourceCd}`;
}

function pickLineageCardRepresentative(
  group: KioskInspectionDrawingTemplateSummaryDto[]
): KioskInspectionDrawingTemplateSummaryDto | undefined {
  if (group.length === 0) return undefined;
  const active = group.find((row) => row.isActive);
  return active ?? group[0];
}

/** 開発専用 — KioskInspectionDrawingLibraryPage と同じレイアウトで UI プレビュー（API 不要） */
export function KioskInspectionDrawingLibraryPreviewPage() {
  const [fhincd, setFhincd] = useState('');
  const [resourceCd, setResourceCd] = useState('');
  const [processFilter, setProcessFilter] = useState<InspectionDrawingLibraryProcessFilter>('all');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [historyGroupKey, setHistoryGroupKey] = useState<string | null>(null);

  const resourceNameMap = INSPECTION_DRAWING_PREVIEW_RESOURCE_NAME_MAP;

  const filteredTemplates = useMemo(() => {
    const q = fhincd.trim().toLowerCase();
    return INSPECTION_DRAWING_PREVIEW_LIBRARY_TEMPLATES.filter((template) => {
      if (!includeInactive && !template.isActive) return false;
      if (q && !template.fhincd.toLowerCase().includes(q)) return false;
      if (resourceCd && template.resourceCd !== resourceCd) return false;
      if (processFilter !== 'all' && template.processGroup !== processFilter) return false;
      return true;
    });
  }, [fhincd, includeInactive, processFilter, resourceCd]);

  const resourceOptions = useMemo(() => {
    const unique = new Set(INSPECTION_DRAWING_PREVIEW_LIBRARY_TEMPLATES.map((t) => t.resourceCd));
    return [...unique].sort((a, b) => a.localeCompare(b, 'ja'));
  }, []);

  const groupByLineage = (rows: KioskInspectionDrawingTemplateSummaryDto[]) => {
    const map = new Map<string, KioskInspectionDrawingTemplateSummaryDto[]>();
    for (const template of rows) {
      const key = lineageGroupKey(template);
      const list = map.get(key) ?? [];
      list.push(template);
      list.sort((a, b) => b.version - a.version);
      map.set(key, list);
    }
    return map;
  };

  const groupedFiltered = useMemo(() => groupByLineage(filteredTemplates), [filteredTemplates]);
  const groupedAll = useMemo(
    () => groupByLineage(INSPECTION_DRAWING_PREVIEW_LIBRARY_TEMPLATES),
    []
  );

  const visibleTemplateCards = useMemo(
    () =>
      [...groupedFiltered.values()]
        .map((group) => pickLineageCardRepresentative(group))
        .filter((row): row is KioskInspectionDrawingTemplateSummaryDto => row != null),
    [groupedFiltered]
  );

  const activeHistoryTemplates = historyGroupKey ? groupedAll.get(historyGroupKey) ?? [] : [];
  const activeHistoryTitle = activeHistoryTemplates[0]?.name ?? '履歴';

  return (
    <KioskInspectionDrawingDevPreviewChrome
      productionPath={KIOSK_INSPECTION_DRAWING_LIBRARY_PATH}
      rootClassName="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white"
    >
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/15 bg-slate-900/70 p-2">
          <div className="min-w-0">
            <h1 className="text-[1.35rem] font-bold leading-tight">検査図面</h1>
            <p className="text-[0.95rem] text-white/65">一覧から編集・履歴確認・新規作成を行います。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghostOnDark" className="min-h-11 text-[1.02rem]" disabled>
              部品測定へ
            </Button>
            <Link
              to="/dev/kiosk-inspection-drawing-create"
              className={buttonClassName('primary', 'inline-flex min-h-11 items-center text-[1.02rem]')}
            >
              新規
            </Link>
          </div>
        </div>

        <InspectionDrawingLibraryFilterBar
          fhincd={fhincd}
          onFhincdChange={setFhincd}
          resourceCd={resourceCd}
          onResourceCdChange={setResourceCd}
          resourceOptions={resourceOptions}
          resourceNameMap={resourceNameMap}
          processFilter={processFilter}
          onProcessFilterChange={setProcessFilter}
          includeInactive={includeInactive}
          onIncludeInactiveChange={setIncludeInactive}
          onRefresh={() => undefined}
        />

        <InspectionDrawingTemplateHistoryDialog
          isOpen={Boolean(historyGroupKey)}
          templateName={activeHistoryTitle}
          templates={activeHistoryTemplates}
          onClose={() => setHistoryGroupKey(null)}
          onOpen={() => setHistoryGroupKey(null)}
        />

        <div className="min-h-0 flex-1 overflow-auto rounded border border-white/15 bg-slate-950/50 p-2">
          {visibleTemplateCards.length === 0 ? (
            <div className="flex min-h-[12rem] items-center justify-center rounded border border-dashed border-white/15 text-[1rem] text-white/60">
              条件に合う検査図面はありません。
            </div>
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {visibleTemplateCards.map((template) => (
                <section
                  key={template.id}
                  className="grid gap-2 rounded border border-white/15 bg-slate-900/80 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[1.2rem] font-bold leading-tight">{template.name}</p>
                      <p className="mt-1 text-[1rem] text-white/80">
                        {template.fhincd} ·{' '}
                        {formatResourceCdWithJapaneseNames(template.resourceCd, resourceNameMap)} ·{' '}
                        {processLabel(template.processGroup)}
                      </p>
                    </div>
                    <span
                      className={clsx(
                        'shrink-0 rounded px-2 py-1 text-[0.92rem] font-semibold',
                        template.isActive ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-white/70'
                      )}
                    >
                      v{template.version} {template.isActive ? '有効' : '履歴'}
                    </span>
                  </div>

                  <div className="grid gap-1 text-[0.98rem] text-white/72">
                    <p>測定点 {template.itemCount}</p>
                    <p>更新 {updatedLabel(template)}</p>
                    <p className="truncate">図面 {template.visualTemplate?.name ?? '未設定'}</p>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link
                      to="/dev/kiosk-inspection-drawing-create"
                      className={buttonClassName('primary', 'inline-flex min-h-11 items-center text-[1rem]')}
                    >
                      編集
                    </Link>
                    <Button
                      type="button"
                      variant="ghostOnDark"
                      className="min-h-11 text-[1rem]"
                      onClick={() => setHistoryGroupKey(lineageGroupKey(template))}
                    >
                      履歴
                    </Button>
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
    </KioskInspectionDrawingDevPreviewChrome>
  );
}
