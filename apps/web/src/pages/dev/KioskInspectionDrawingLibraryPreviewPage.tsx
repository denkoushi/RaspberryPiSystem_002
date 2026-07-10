import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button, buttonClassName } from '../../components/ui/Button';
import {
  InspectionDrawingLibraryFilterBar,
  InspectionDrawingLibraryTemplateTable,
  InspectionDrawingDigitTenkey,
  InspectionDrawingTemplateHistoryDialog,
  KioskInspectionDrawingVisualLibrarySection,
  KIOSK_INSPECTION_DRAWING_LIBRARY_PATH,
  matchesDigitQuery,
  type InspectionDrawingLibraryProcessFilter
} from '../../features/part-measurement/inspection-drawing';
import {
  INSPECTION_DRAWING_PREVIEW_LIBRARY_TEMPLATE_GRID,
  INSPECTION_DRAWING_PREVIEW_LIBRARY_TEMPLATES,
  INSPECTION_DRAWING_PREVIEW_RESOURCE_NAME_MAP,
  INSPECTION_DRAWING_PREVIEW_VISUAL_LIBRARY
} from '../../features/part-measurement/inspection-drawing/inspectionDrawingPreviewFixtures';

import { KioskInspectionDrawingDevPreviewChrome } from './KioskInspectionDrawingDevPreviewChrome';
import { INSPECTION_DRAWING_DEV_RETURN_TO_LIBRARY_STATE } from './kioskInspectionDrawingDevReturnNavigation';

import type { KioskInspectionDrawingTemplateSummaryDto } from '../../features/part-measurement/types';

function lineageGroupKey(template: KioskInspectionDrawingTemplateSummaryDto): string {
  if (template.siblingGroupId) return `sibling:${template.siblingGroupId}`;
  return `${template.fhincd}::${template.processGroup ?? 'none'}::${template.resourceCd}`;
}

function pickLineageCardRepresentative(
  group: KioskInspectionDrawingTemplateSummaryDto[]
): KioskInspectionDrawingTemplateSummaryDto | undefined {
  if (group.length === 0) return undefined;
  const active = group.find((row) => row.isActive);
  return active ?? group[0];
}

/** 開発専用 — 密度改善後レイアウトの UI プレビュー（API 不要・モックデータ） */
export function KioskInspectionDrawingLibraryPreviewPage() {
  const [fhincd, setFhincd] = useState('');
  const [visualName, setVisualName] = useState('');
  const [resourceCd, setResourceCd] = useState('');
  const [processFilter, setProcessFilter] = useState<InspectionDrawingLibraryProcessFilter>('all');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [digitQuery, setDigitQuery] = useState('');
  const [showInactiveTemplates, setShowInactiveTemplates] = useState(false);
  const [historyGroupKey, setHistoryGroupKey] = useState<string | null>(null);

  const resourceNameMap = INSPECTION_DRAWING_PREVIEW_RESOURCE_NAME_MAP;
  const sourceTemplates = INSPECTION_DRAWING_PREVIEW_LIBRARY_TEMPLATE_GRID;

  const filteredTemplates = useMemo(() => {
    const q = fhincd.trim().toLowerCase();
    const visualQ = visualName.trim().toLowerCase();
    return sourceTemplates.filter((template) => {
      if (!includeInactive && !showInactiveTemplates && !template.isActive) return false;
      if (q && !template.fhincd.toLowerCase().includes(q)) return false;
      if (visualQ && !template.visualTemplate?.name.toLowerCase().includes(visualQ)) return false;
      if (!matchesDigitQuery(template.visualTemplate?.name, digitQuery)) return false;
      if (
        resourceCd &&
        template.resourceCd !== resourceCd &&
        !template.siblingGroup?.activeResourceCds.includes(resourceCd)
      ) {
        return false;
      }
      if (processFilter !== 'all' && template.processGroup !== processFilter) return false;
      return true;
    });
  }, [
    digitQuery,
    fhincd,
    includeInactive,
    processFilter,
    resourceCd,
    showInactiveTemplates,
    sourceTemplates,
    visualName
  ]);

  const resourceOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const template of sourceTemplates) {
      unique.add(template.resourceCd);
      for (const cd of template.siblingGroup?.activeResourceCds ?? []) {
        unique.add(cd);
      }
    }
    return [...unique].sort((a, b) => a.localeCompare(b, 'ja'));
  }, [sourceTemplates]);

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
  const groupedAll = useMemo(() => groupByLineage(sourceTemplates), [sourceTemplates]);

  const visibleTemplateRows = useMemo(
    () =>
      [...groupedFiltered.values()]
        .map((group) => pickLineageCardRepresentative(group))
        .filter(
          (row): row is KioskInspectionDrawingTemplateSummaryDto =>
            row != null && (showInactiveTemplates || row.isActive)
        ),
    [groupedFiltered, showInactiveTemplates]
  );

  const activeHistoryTemplates = historyGroupKey ? groupedAll.get(historyGroupKey) ?? [] : [];
  const activeHistoryTitle = activeHistoryTemplates[0]?.name ?? '履歴';
  const hasActiveTemplateFilters =
    fhincd.trim() !== '' ||
    visualName.trim() !== '' ||
    resourceCd !== '' ||
    processFilter !== 'all' ||
    includeInactive;
  const resetTemplateFilters = () => {
    setFhincd('');
    setVisualName('');
    setResourceCd('');
    setProcessFilter('all');
    setIncludeInactive(false);
  };

  return (
    <KioskInspectionDrawingDevPreviewChrome
      productionPath={KIOSK_INSPECTION_DRAWING_LIBRARY_PATH}
      rootClassName="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white"
    >
      <div className="flex h-[60px] flex-nowrap items-center gap-2 overflow-hidden rounded border border-white/15 bg-slate-900/70 p-2">
        <div className="min-w-0 shrink-0">
          <h1 className="text-[1.35rem] font-bold leading-tight">検査図面</h1>
        </div>
        <InspectionDrawingDigitTenkey value={digitQuery} onChange={setDigitQuery} />
        <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-2">
          <Button type="button" variant="ghostOnDark" className="min-h-11 text-[1.02rem]" disabled>
            部品測定へ
          </Button>
          <Link
            to="/dev/kiosk-inspection-drawing-create"
            state={INSPECTION_DRAWING_DEV_RETURN_TO_LIBRARY_STATE}
            className={buttonClassName('primary', 'inline-flex min-h-11 items-center text-[1.02rem]')}
          >
            新規
          </Link>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-2 overflow-auto 2xl:grid-cols-[31rem_minmax(0,1fr)] 2xl:overflow-hidden">
        <KioskInspectionDrawingVisualLibrarySection
          previewVisuals={INSPECTION_DRAWING_PREVIEW_VISUAL_LIBRARY}
          onRegisterClick={() => undefined}
          digitQuery={digitQuery}
        />

        <section
          className="flex min-h-0 min-w-0 flex-col gap-1.5 rounded border border-white/15 bg-slate-950/45 p-1.5"
          aria-labelledby="inspection-drawing-template-pane-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 id="inspection-drawing-template-pane-heading" className="text-[1.08rem] font-bold text-white/90">
              検査図面テンプレート
            </h2>
            <span className="text-[0.9rem] font-semibold text-white/55">{visibleTemplateRows.length}件</span>
          </div>

          <InspectionDrawingLibraryFilterBar
            fhincd={fhincd}
            onFhincdChange={setFhincd}
            visualName={visualName}
            onVisualNameChange={setVisualName}
            resourceCd={resourceCd}
            onResourceCdChange={setResourceCd}
            resourceOptions={resourceOptions}
            resourceNameMap={resourceNameMap}
            processFilter={processFilter}
            onProcessFilterChange={setProcessFilter}
            includeInactive={includeInactive}
            onIncludeInactiveChange={setIncludeInactive}
            showInactiveTemplates={showInactiveTemplates}
            onShowInactiveTemplatesChange={setShowInactiveTemplates}
            onReload={() => undefined}
            onReset={resetTemplateFilters}
            resetDisabled={!hasActiveTemplateFilters}
          />

          <InspectionDrawingTemplateHistoryDialog
            isOpen={Boolean(historyGroupKey)}
            templateName={activeHistoryTitle}
            templates={
              activeHistoryTemplates.length > 0 ? activeHistoryTemplates : INSPECTION_DRAWING_PREVIEW_LIBRARY_TEMPLATES
            }
            onClose={() => setHistoryGroupKey(null)}
            onOpen={() => setHistoryGroupKey(null)}
          />

          <div className="min-h-0 flex-1 rounded bg-slate-950/35 p-1">
            <InspectionDrawingLibraryTemplateTable
              templates={visibleTemplateRows}
              resourceNameMap={resourceNameMap}
              onHistoryClick={setHistoryGroupKey}
              lineageGroupKey={lineageGroupKey}
              editPath={() => '/dev/kiosk-inspection-drawing-create'}
              printPath={() => '/dev/kiosk-inspection-drawing-print'}
              createFromSourcePath={() => '/dev/kiosk-inspection-drawing-create'}
              linkState={INSPECTION_DRAWING_DEV_RETURN_TO_LIBRARY_STATE}
              onRetireClick={() => undefined}
            />
          </div>
        </section>
      </div>
    </KioskInspectionDrawingDevPreviewChrome>
  );
}
