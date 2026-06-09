import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { listKioskInspectionDrawingTemplates } from '../../api/client';
import { useKioskProductionScheduleResources } from '../../api/hooks';
import { Button, buttonClassName } from '../../components/ui/Button';
import {
  InspectionDrawingLibraryFilterBar,
  InspectionDrawingLibraryTemplateGrid,
  InspectionDrawingTemplateHistoryDialog,
  KioskInspectionDrawingVisualLibrarySection,
  KioskInspectionDrawingVisualUploadModal,
  kioskInspectionDrawingTemplateEditPath,
  KIOSK_INSPECTION_DRAWING_CREATE_PATH,
  type InspectionDrawingLibraryProcessFilter
} from '../../features/part-measurement/inspection-drawing';

import { INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE } from './kioskInspectionDrawingReturnNavigation';

import type {
  KioskInspectionDrawingTemplateSummaryDto,
  PartMeasurementVisualTemplateDto
} from '../../features/part-measurement/types';

function lineageGroupKey(template: KioskInspectionDrawingTemplateSummaryDto): string {
  return `${template.fhincd}::${template.processGroup ?? 'none'}::${template.resourceCd}`;
}

/** 一覧カードは有効版を代表表示。無効版のみの系譜は最新版を表示 */
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
  const [fhincd, setFhincd] = useState('');
  const [visualName, setVisualName] = useState('');
  const [resourceCd, setResourceCd] = useState('');
  const [processFilter, setProcessFilter] = useState<InspectionDrawingLibraryProcessFilter>('all');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [templates, setTemplates] = useState<KioskInspectionDrawingTemplateSummaryDto[]>([]);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);
  const [historyGroupKey, setHistoryGroupKey] = useState<string | null>(null);
  const [visualUploadOpen, setVisualUploadOpen] = useState(false);
  const [visualLibraryRefreshToken, setVisualLibraryRefreshToken] = useState(0);

  const resourceNameMap = useMemo(
    () => resourcesQuery.data?.resourceNameMap ?? {},
    [resourcesQuery.data?.resourceNameMap]
  );
  const resourceOptions = useMemo(() => {
    const unique = new Set(resourcesQuery.data?.resources ?? []);
    for (const template of templates) unique.add(template.resourceCd);
    return [...unique].sort((a, b) => a.localeCompare(b, 'ja'));
  }, [resourcesQuery.data?.resources, templates]);

  const groupedTemplates = useMemo(() => {
    const map = new Map<string, KioskInspectionDrawingTemplateSummaryDto[]>();
    for (const template of templates) {
      const key = lineageGroupKey(template);
      const list = map.get(key) ?? [];
      list.push(template);
      list.sort((a, b) => b.version - a.version);
      map.set(key, list);
    }
    return map;
  }, [templates]);
  const visibleTemplateCards = useMemo(
    () =>
      [...groupedTemplates.values()]
        .map((group) => pickLineageCardRepresentative(group))
        .filter((row): row is KioskInspectionDrawingTemplateSummaryDto => row != null),
    [groupedTemplates]
  );
  const activeHistoryTemplates = historyGroupKey ? groupedTemplates.get(historyGroupKey) ?? [] : [];
  const activeHistoryTitle = activeHistoryTemplates[0]?.name ?? '履歴';

  const loadTemplates = useCallback(
    async (filters: {
      includeInactive: boolean;
      fhincd: string;
      visualName: string;
      resourceCd: string;
      processFilter: InspectionDrawingLibraryProcessFilter;
    }) =>
      listKioskInspectionDrawingTemplates({
        includeInactive: filters.includeInactive,
        fhincd: filters.fhincd.trim() || undefined,
        visualName: filters.visualName.trim() || undefined,
        processGroup: filters.processFilter === 'all' ? undefined : filters.processFilter,
        resourceCd: filters.resourceCd || undefined
      }),
    []
  );

  const refresh = useCallback(async () => {
    setTemplateBusy(true);
    setTemplateMessage(null);
    try {
      const list = await loadTemplates({ includeInactive, fhincd, visualName, resourceCd, processFilter });
      setTemplates(list);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setTemplateMessage(err.response?.data?.message ?? '検査図面テンプレートの取得に失敗しました。');
      setTemplates([]);
    } finally {
      setTemplateBusy(false);
    }
  }, [fhincd, includeInactive, loadTemplates, processFilter, resourceCd, visualName]);

  const handleVisualUploadSuccess = useCallback((visual: PartMeasurementVisualTemplateDto) => {
    setVisualUploadOpen(false);
    setVisualLibraryRefreshToken((token) => token + 1);
    setTemplateMessage(`図面「${visual.name}」を登録しました。`);
  }, []);

  const handleVisualRenamed = useCallback(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    setTemplateBusy(true);
    setTemplateMessage(null);
    void loadTemplates({
      includeInactive: false,
      fhincd: '',
      visualName: '',
      resourceCd: '',
      processFilter: 'all'
    })
      .then((list) => {
        if (!cancelled) setTemplates(list);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const err = e as { response?: { data?: { message?: string } } };
        setTemplateMessage(err.response?.data?.message ?? '検査図面テンプレートの取得に失敗しました。');
        setTemplates([]);
      })
      .finally(() => {
        if (!cancelled) setTemplateBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadTemplates]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/15 bg-slate-900/70 p-2">
        <div className="min-w-0">
          <h1 className="text-[1.35rem] font-bold leading-tight">検査図面</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            className={buttonClassName('primary', 'inline-flex min-h-11 items-center text-[1.02rem]')}
          >
            新規
          </Link>
        </div>
      </div>

      <KioskInspectionDrawingVisualLibrarySection
        refreshToken={visualLibraryRefreshToken}
        onRegisterClick={() => setVisualUploadOpen(true)}
        onVisualRenamed={handleVisualRenamed}
      />

      <KioskInspectionDrawingVisualUploadModal
        isOpen={visualUploadOpen}
        onClose={() => setVisualUploadOpen(false)}
        onSuccess={handleVisualUploadSuccess}
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
        onRefresh={() => void refresh()}
        refreshBusy={templateBusy}
      />

      {templateMessage ? <p className="text-[1rem] font-semibold text-amber-200">{templateMessage}</p> : null}

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

      <div className="min-h-0 flex-1 overflow-auto rounded border border-white/15 bg-slate-950/50 p-1.5">
        <InspectionDrawingLibraryTemplateGrid
          templates={visibleTemplateCards}
          resourceNameMap={resourceNameMap}
          busy={templateBusy}
          onHistoryClick={setHistoryGroupKey}
          lineageGroupKey={lineageGroupKey}
        />
      </div>
    </div>
  );
}
