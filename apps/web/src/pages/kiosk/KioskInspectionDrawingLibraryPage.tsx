import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { retirePartMeasurementTemplate } from '../../api/client';
import { useKioskProductionScheduleResources } from '../../api/hooks';
import { Button, buttonClassName } from '../../components/ui/Button';
import {
  kioskButtonPrimaryClassName,
  kioskPageTitleClassName
} from '../../features/kiosk/kioskTheme';
import {
  InspectionDrawingDigitTenkey,
  InspectionDrawingLibraryFilterBar,
  InspectionDrawingLibraryTemplateTable,
  InspectionDrawingTemplateHistoryDialog,
  INSPECTION_DRAWING_PRINT_PRODUCTION_ENABLED,
  KioskInspectionDrawingVisualLibrarySection,
  KioskInspectionDrawingVisualUploadModal,
  kioskInspectionDrawingTemplateEditPath,
  kioskInspectionDrawingTemplatePrintPath,
  KIOSK_INSPECTION_DRAWING_CREATE_PATH,
  INSPECTION_DRAWING_VISUAL_LIBRARY_LIMIT,
  INSPECTION_DRAWING_VISUAL_SEARCH_DEBOUNCE_MS,
  useInspectionDrawingResourceCdsByVisualId,
  useInspectionDrawingTemplateLibrary
} from '../../features/part-measurement/inspection-drawing';

import { INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE } from './kioskInspectionDrawingReturnNavigation';

import type {
  KioskInspectionDrawingTemplateSummaryDto,
  PartMeasurementVisualTemplateDto
} from '../../features/part-measurement/types';

function lineageGroupKey(template: KioskInspectionDrawingTemplateSummaryDto): string {
  if (template.siblingGroupId) return `sibling:${template.siblingGroupId}`;
  return `${template.fhincd}::${template.processGroup ?? 'none'}::${template.resourceCd}`;
}

/** 一覧行は有効版を代表表示。無効版のみの系譜は最新版を表示 */
function pickLineageCardRepresentative(
  group: KioskInspectionDrawingTemplateSummaryDto[]
): KioskInspectionDrawingTemplateSummaryDto | undefined {
  if (group.length === 0) return undefined;
  const active = group.find((row) => row.isActive);
  return active ?? group[0];
}

export function KioskInspectionDrawingLibraryPage() {
  const navigate = useNavigate();
  const resourcesQuery = useKioskProductionScheduleResources();
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);
  const [historyGroupKey, setHistoryGroupKey] = useState<string | null>(null);
  const [visualUploadOpen, setVisualUploadOpen] = useState(false);
  const [visualLibraryRefreshToken, setVisualLibraryRefreshToken] = useState(0);
  const [resourceCdsMapRefreshToken, setResourceCdsMapRefreshToken] = useState(0);
  const [digitQuery, setDigitQuery] = useState('');
  const [debouncedDigitQuery, setDebouncedDigitQuery] = useState('');
  const [retireBusy, setRetireBusy] = useState(false);
  const retireBusyRef = useRef(false);
  const [showInactiveTemplates, setShowInactiveTemplates] = useState(false);
  const templateLibrary = useInspectionDrawingTemplateLibrary({
    digitQuery: debouncedDigitQuery,
    showInactiveTemplates
  });
  const resourceCdsByVisualId = useInspectionDrawingResourceCdsByVisualId(
    visualLibraryRefreshToken + resourceCdsMapRefreshToken
  );
  const { filters, templates } = templateLibrary;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedDigitQuery(digitQuery);
    }, INSPECTION_DRAWING_VISUAL_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [digitQuery]);

  const resourceNameMap = useMemo(
    () => resourcesQuery.data?.resourceNameMap ?? {},
    [resourcesQuery.data?.resourceNameMap]
  );
  const resourceOptions = useMemo(() => {
    const unique = new Set(resourcesQuery.data?.resources ?? []);
    for (const template of templates) {
      unique.add(template.resourceCd);
      for (const cd of template.siblingGroup?.activeResourceCds ?? []) {
        unique.add(cd);
      }
    }
    return [...unique].sort((a, b) => a.localeCompare(b, 'ja'));
  }, [resourcesQuery.data?.resources, templates]);

  const groupedTemplates = useMemo(() => {
    const map = new Map<string, KioskInspectionDrawingTemplateSummaryDto[]>();
    for (const template of templates) {
      const key = lineageGroupKey(template);
      const list = map.get(key) ?? [];
      list.push(template);
      list.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return b.version - a.version || a.resourceCd.localeCompare(b.resourceCd, 'ja');
      });
      map.set(key, list);
    }
    return map;
  }, [templates]);
  const allVisibleTemplateRows = useMemo(
    () =>
      [...groupedTemplates.values()]
        .map((group) => pickLineageCardRepresentative(group))
        .filter(
          (row): row is KioskInspectionDrawingTemplateSummaryDto =>
            row != null && (showInactiveTemplates || row.isActive)
        ),
    [groupedTemplates, showInactiveTemplates]
  );
  const templateDigitSearchHasMore =
    debouncedDigitQuery.length > 0 && allVisibleTemplateRows.length > INSPECTION_DRAWING_VISUAL_LIBRARY_LIMIT;
  const visibleTemplateRows = useMemo(
    () =>
      debouncedDigitQuery.length > 0
        ? allVisibleTemplateRows.slice(0, INSPECTION_DRAWING_VISUAL_LIBRARY_LIMIT)
        : allVisibleTemplateRows,
    [allVisibleTemplateRows, debouncedDigitQuery]
  );
  const activeHistoryTemplates = historyGroupKey ? groupedTemplates.get(historyGroupKey) ?? [] : [];
  const activeHistoryTitle =
    activeHistoryTemplates[0]?.siblingGroup?.displayName ??
    activeHistoryTemplates[0]?.name ??
    '履歴';

  const handleVisualUploadSuccess = useCallback((visual: PartMeasurementVisualTemplateDto) => {
    setVisualUploadOpen(false);
    setVisualLibraryRefreshToken((token) => token + 1);
    setTemplateMessage(`図面「${visual.name}」を登録しました。`);
  }, []);

  const handleVisualRenamed = useCallback(() => {
    templateLibrary.reload();
    setResourceCdsMapRefreshToken((token) => token + 1);
  }, [templateLibrary]);

  const handleRetireTemplate = useCallback(
    async (template: KioskInspectionDrawingTemplateSummaryDto) => {
      if (retireBusyRef.current) return;
      if (
        !window.confirm(
          `品番「${template.fhincd}」資源「${template.resourceCd}」の有効版（v${template.version}）を無効化します。この資源の有効版のみ対象です。よろしいですか。`
        )
      ) {
        return;
      }
      retireBusyRef.current = true;
      setRetireBusy(true);
      setTemplateMessage(null);
      try {
        await retirePartMeasurementTemplate(template.id);
        setTemplateMessage(`テンプレートを無効化しました: ${template.fhincd} / ${template.resourceCd}`);
        templateLibrary.reload();
        setResourceCdsMapRefreshToken((token) => token + 1);
      } catch (error: unknown) {
        const message =
          error && typeof error === 'object' && 'response' in error
            ? String(
                (error as { response?: { data?: { message?: string } } }).response?.data?.message ??
                  'テンプレートの無効化に失敗しました。'
              )
            : 'テンプレートの無効化に失敗しました。';
        setTemplateMessage(message);
      } finally {
        retireBusyRef.current = false;
        setRetireBusy(false);
      }
    },
    [templateLibrary]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <div className="flex h-[60px] flex-nowrap items-center gap-2 overflow-hidden rounded border border-white/15 bg-slate-900/70 p-2">
        <div className="min-w-0 shrink-0">
          <h1 className={kioskPageTitleClassName}>検査図面</h1>
        </div>
        <InspectionDrawingDigitTenkey value={digitQuery} onChange={setDigitQuery} disabled={retireBusy} />
        <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-2">
          <Button
            type="button"
            variant="ghostOnDark"
            className="min-h-11 text-[1.02rem]"
            onClick={() => void navigate('/kiosk/part-measurement')}
          >
            部品測定へ
          </Button>
          <Link
            to={KIOSK_INSPECTION_DRAWING_CREATE_PATH}
            state={INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE}
            className={buttonClassName('primary', clsx(kioskButtonPrimaryClassName, 'inline-flex items-center text-base'))}
          >
            新規
          </Link>
        </div>
      </div>

      <KioskInspectionDrawingVisualUploadModal
        isOpen={visualUploadOpen}
        onClose={() => setVisualUploadOpen(false)}
        onSuccess={handleVisualUploadSuccess}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-2 overflow-auto 2xl:grid-cols-[31rem_minmax(0,1fr)] 2xl:overflow-hidden">
        <KioskInspectionDrawingVisualLibrarySection
          refreshToken={visualLibraryRefreshToken}
          onRegisterClick={() => setVisualUploadOpen(true)}
          onVisualRenamed={handleVisualRenamed}
          resourceCdsByVisualId={resourceCdsByVisualId}
          resourceNameMap={resourceNameMap}
          digitQuery={debouncedDigitQuery}
        />

        <section
          className="flex min-h-0 min-w-0 flex-col gap-1.5 rounded border border-white/15 bg-slate-950/45 p-1.5"
          aria-labelledby="inspection-drawing-template-pane-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 id="inspection-drawing-template-pane-heading" className="text-[1.08rem] font-bold text-white/90">
              検査図面テンプレート
            </h2>
            <span className="text-sm font-semibold text-white/55">{visibleTemplateRows.length}件</span>
          </div>

          <InspectionDrawingLibraryFilterBar
            fhincd={filters.fhincd}
            onFhincdChange={templateLibrary.setFhincd}
            visualName={filters.visualName}
            onVisualNameChange={templateLibrary.setVisualName}
            resourceCd={filters.resourceCd}
            onResourceCdChange={templateLibrary.setResourceCd}
            resourceOptions={resourceOptions}
            resourceNameMap={resourceNameMap}
            processFilter={filters.processFilter}
            onProcessFilterChange={templateLibrary.setProcessFilter}
            includeInactive={filters.includeInactive}
            onIncludeInactiveChange={templateLibrary.setIncludeInactive}
            showInactiveTemplates={showInactiveTemplates}
            onShowInactiveTemplatesChange={setShowInactiveTemplates}
            showInactiveTemplatesDisabled={retireBusy}
            onReload={templateLibrary.reload}
            onReset={templateLibrary.resetFilters}
            resetDisabled={!templateLibrary.hasActiveFilters}
            busy={templateLibrary.loading || retireBusy}
          />

          {templateDigitSearchHasMore ? (
            <p role="status" className="px-1 text-sm font-semibold text-amber-200">
              一致するテンプレートが40件を超えています。数字を追加して絞り込んでください。
            </p>
          ) : null}

          {templateLibrary.error ?? templateMessage ? (
            <p className="px-1 text-[1rem] font-semibold text-amber-200">{templateLibrary.error ?? templateMessage}</p>
          ) : null}

          <InspectionDrawingTemplateHistoryDialog
            isOpen={Boolean(historyGroupKey)}
            templateName={activeHistoryTitle}
            templates={activeHistoryTemplates}
            onClose={() => setHistoryGroupKey(null)}
            onOpen={(template) => {
              setHistoryGroupKey(null);
              void navigate(kioskInspectionDrawingTemplateEditPath(template.id), {
                state: INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE
              });
            }}
          />

          <div className="min-h-0 flex-1 rounded bg-slate-950/35 p-1">
            <InspectionDrawingLibraryTemplateTable
              templates={visibleTemplateRows}
              resourceNameMap={resourceNameMap}
              busy={templateLibrary.loading || retireBusy}
              onHistoryClick={setHistoryGroupKey}
              lineageGroupKey={lineageGroupKey}
              onRetireClick={(template) => void handleRetireTemplate(template)}
              printPath={
                INSPECTION_DRAWING_PRINT_PRODUCTION_ENABLED
                  ? kioskInspectionDrawingTemplatePrintPath
                  : undefined
              }
            />
          </div>
        </section>
      </div>
    </div>
  );
}
