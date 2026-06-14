import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button, buttonClassName } from '../../components/ui/Button';
import {
  InspectionDrawingLibraryFilterBar,
  InspectionDrawingLibraryTemplateGrid,
  InspectionDrawingTemplateHistoryDialog,
  KioskInspectionDrawingVisualLibrarySection,
  KIOSK_INSPECTION_DRAWING_LIBRARY_PATH,
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
  const [historyGroupKey, setHistoryGroupKey] = useState<string | null>(null);

  const resourceNameMap = INSPECTION_DRAWING_PREVIEW_RESOURCE_NAME_MAP;
  const sourceTemplates = INSPECTION_DRAWING_PREVIEW_LIBRARY_TEMPLATE_GRID;

  const filteredTemplates = useMemo(() => {
    const q = fhincd.trim().toLowerCase();
    const visualQ = visualName.trim().toLowerCase();
    return sourceTemplates.filter((template) => {
      if (!includeInactive && !template.isActive) return false;
      if (q && !template.fhincd.toLowerCase().includes(q)) return false;
      if (visualQ && !template.visualTemplate?.name.toLowerCase().includes(visualQ)) return false;
      if (resourceCd && template.resourceCd !== resourceCd) return false;
      if (processFilter !== 'all' && template.processGroup !== processFilter) return false;
      return true;
    });
  }, [fhincd, includeInactive, processFilter, resourceCd, sourceTemplates, visualName]);

  const resourceOptions = useMemo(() => {
    const unique = new Set(sourceTemplates.map((t) => t.resourceCd));
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
        </div>
        <div className="flex flex-wrap items-center gap-2">
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

      <KioskInspectionDrawingVisualLibrarySection
        previewVisuals={INSPECTION_DRAWING_PREVIEW_VISUAL_LIBRARY}
        onRegisterClick={() => undefined}
      />

      <div className="rounded border border-white/10 bg-slate-900/40 px-2 py-1">
        <h2 className="text-[1.05rem] font-bold text-white/90">検査図面テンプレート</h2>
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
        onRefresh={() => undefined}
      />

      <InspectionDrawingTemplateHistoryDialog
        isOpen={Boolean(historyGroupKey)}
        templateName={activeHistoryTitle}
        templates={activeHistoryTemplates.length > 0 ? activeHistoryTemplates : INSPECTION_DRAWING_PREVIEW_LIBRARY_TEMPLATES}
        onClose={() => setHistoryGroupKey(null)}
        onOpen={() => setHistoryGroupKey(null)}
      />

      <div className="min-h-0 flex-1 overflow-auto rounded border border-white/15 bg-slate-950/50 p-1.5">
        <InspectionDrawingLibraryTemplateGrid
          templates={visibleTemplateCards}
          resourceNameMap={resourceNameMap}
          onHistoryClick={setHistoryGroupKey}
          lineageGroupKey={lineageGroupKey}
          editPath={() => '/dev/kiosk-inspection-drawing-create'}
          printPath={() => '/dev/kiosk-inspection-drawing-print'}
          createFromSourcePath={() => '/dev/kiosk-inspection-drawing-create'}
          linkState={INSPECTION_DRAWING_DEV_RETURN_TO_LIBRARY_STATE}
        />
      </div>
    </KioskInspectionDrawingDevPreviewChrome>
  );
}
