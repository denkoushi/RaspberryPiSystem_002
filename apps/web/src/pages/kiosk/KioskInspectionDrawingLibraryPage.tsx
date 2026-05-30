import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { listKioskInspectionDrawingTemplates } from '../../api/client';
import { useKioskProductionScheduleResources } from '../../api/hooks';
import { Button, buttonClassName } from '../../components/ui/Button';
import { formatResourceCdWithJapaneseNames } from '../../features/kiosk/leaderOrderBoard/formatResourceCdWithJapaneseNames';
import {
  InspectionDrawingLibraryFilterBar,
  InspectionDrawingTemplateHistoryDialog,
  kioskInspectionDrawingTemplateEditPath,
  KIOSK_INSPECTION_DRAWING_CREATE_PATH,
  type InspectionDrawingLibraryProcessFilter
} from '../../features/part-measurement/inspection-drawing';

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
  const [resourceCd, setResourceCd] = useState('');
  const [processFilter, setProcessFilter] = useState<InspectionDrawingLibraryProcessFilter>('all');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [templates, setTemplates] = useState<KioskInspectionDrawingTemplateSummaryDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [historyGroupKey, setHistoryGroupKey] = useState<string | null>(null);

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
      resourceCd: string;
      processFilter: InspectionDrawingLibraryProcessFilter;
    }) =>
      listKioskInspectionDrawingTemplates({
        includeInactive: filters.includeInactive,
        fhincd: filters.fhincd.trim() || undefined,
        processGroup: filters.processFilter === 'all' ? undefined : filters.processFilter,
        resourceCd: filters.resourceCd || undefined
      }),
    []
  );

  const refresh = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const list = await loadTemplates({ includeInactive, fhincd, resourceCd, processFilter });
      setTemplates(list);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '検査図面テンプレートの取得に失敗しました。');
      setTemplates([]);
    } finally {
      setBusy(false);
    }
  }, [fhincd, includeInactive, loadTemplates, processFilter, resourceCd]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setMessage(null);
    void loadTemplates({
      includeInactive: false,
      fhincd: '',
      resourceCd: '',
      processFilter: 'all'
    })
      .then((list) => {
        if (!cancelled) setTemplates(list);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const err = e as { response?: { data?: { message?: string } } };
        setMessage(err.response?.data?.message ?? '検査図面テンプレートの取得に失敗しました。');
        setTemplates([]);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
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
          <p className="text-[0.95rem] text-white/65">一覧から編集・履歴確認・新規作成を行います。</p>
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
        onRefresh={() => void refresh()}
        refreshBusy={busy}
      />

      {message ? <p className="text-[1rem] font-semibold text-amber-200">{message}</p> : null}

      <InspectionDrawingTemplateHistoryDialog
        isOpen={Boolean(historyGroupKey)}
        templateName={activeHistoryTitle}
        templates={activeHistoryTemplates}
        onClose={() => setHistoryGroupKey(null)}
        onOpen={(template) => {
          setHistoryGroupKey(null);
          void navigate(kioskInspectionDrawingTemplateEditPath(template.id));
        }}
      />

      <div className="min-h-0 flex-1 overflow-auto rounded border border-white/15 bg-slate-950/50 p-2">
        {visibleTemplateCards.length === 0 ? (
          <div className="flex min-h-[12rem] items-center justify-center rounded border border-dashed border-white/15 text-[1rem] text-white/60">
            {busy ? '読込中…' : '条件に合う検査図面はありません。'}
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
                      {template.fhincd} · {formatResourceCdWithJapaneseNames(template.resourceCd, resourceNameMap)} ·{' '}
                      {processLabel(template.processGroup)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={clsx(
                        'rounded px-2 py-1 text-[0.92rem] font-semibold',
                        template.isActive ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-white/70'
                      )}
                    >
                      v{template.version} {template.isActive ? '有効' : '履歴'}
                    </span>
                  </div>
                </div>

                <div className="grid gap-1 text-[0.98rem] text-white/72">
                  <p>測定点 {template.itemCount}</p>
                  <p>更新 {updatedLabel(template)}</p>
                  <p className="truncate">図面 {template.visualTemplate?.name ?? '未設定'}</p>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Link
                    to={kioskInspectionDrawingTemplateEditPath(template.id)}
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
    </div>
  );
}
