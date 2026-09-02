import { useId, useMemo, useState } from 'react';

import { collapseNonconformitiesForDisplay } from './selfInspectionNonconformityDisplay';

import type { SelfInspectionNonconformity } from '../../api/domains/self-inspection-nonconformities';

export type SelfInspectionNonconformityPanelProps = {
  items?: ReadonlyArray<SelfInspectionNonconformity>;
  isLoading?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
};

const fields: ReadonlyArray<{
  key: keyof Omit<SelfInspectionNonconformity, 'id'>;
  label: string;
  emptyValue?: string;
}> = [
  { key: 'discoveredOn', label: '発見日' },
  { key: 'originDepartmentName', label: '起因部署' },
  { key: 'remarks', label: '備考' },
  { key: 'nonconformityContent', label: '不適合内容' },
  { key: 'dispositionContent', label: '処置内容' },
  { key: 'correctiveContent1', label: '是正内容1' },
  { key: 'correctiveContent2', label: '是正内容2' },
  { key: 'partName', label: '部品名', emptyValue: '未登録' },
  { key: 'machineName', label: '機種名', emptyValue: '未登録' }
];

function displayValue(value: string | null | undefined, emptyValue = '—'): string {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : emptyValue;
}

/**
 * Collapsed-by-default kiosk panel for the persisted nonconformity read model.
 * The expanded content is absolutely positioned so the work-instruction
 * photo grid keeps its existing size and responsive layout.
 */
export function SelfInspectionNonconformityPanel({
  items = [],
  isLoading = false,
  errorMessage,
  onRetry
}: SelfInspectionNonconformityPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const displayItems = useMemo(() => collapseNonconformitiesForDisplay(items), [items]);
  const countLabel = displayItems.length > 0 ? `（${displayItems.length}件）` : '';

  // A successful empty response is intentionally silent.  The viewer should
  // not reserve a header control for parts with no active cases.
  if (displayItems.length === 0 && !isLoading && !errorMessage) return null;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        className="min-h-11 shrink-0 rounded-md border border-amber-300/50 bg-amber-300/10 px-3 text-sm font-bold text-amber-100 hover:bg-amber-300/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((current) => !current)}
      >
        不適合情報{countLabel}
      </button>

      {expanded ? (
        <aside
          id={panelId}
          className="absolute right-0 top-[calc(100%+0.5rem)] z-20 flex max-h-[calc(100dvh-7rem)] w-[min(90vw,34rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-amber-300/50 bg-slate-950/95 text-white shadow-2xl"
          role="region"
          aria-label="不適合情報"
        >
          <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-white/15 bg-slate-900 px-3 py-2">
            <h3 className="min-w-0 truncate text-sm font-bold text-amber-100">
              不適合情報{countLabel}
            </h3>
            <button
              type="button"
              className="min-h-11 min-w-11 shrink-0 rounded-md border border-white/25 px-2 text-xs font-bold text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              onClick={() => setExpanded(false)}
              aria-label="不適合情報を閉じる"
            >
              閉じる
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {isLoading ? (
              <p className="text-sm font-semibold text-white/65" role="status">
                不適合情報を読み込み中…
              </p>
            ) : errorMessage ? (
              <div className="space-y-3" role="alert">
                <p className="text-sm font-semibold text-rose-100">{errorMessage}</p>
                {onRetry ? (
                  <button
                    type="button"
                    className="min-h-11 rounded-md border border-rose-200/60 px-3 text-sm font-bold text-rose-100 hover:bg-rose-200/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    onClick={onRetry}
                  >
                    再試行
                  </button>
                ) : null}
              </div>
            ) : displayItems.length === 0 ? (
              <p className="text-sm font-semibold text-white/65">
                この部品の不適合情報はありません
              </p>
            ) : (
              <div className="space-y-3" role="list" aria-label="不適合情報一覧">
                {displayItems.map((item, index) => (
                  <article
                    key={item.id}
                    className="rounded-md border border-white/15 bg-slate-900/70 p-3"
                    role="listitem"
                    aria-label={`不適合情報 ${index + 1}`}
                  >
                    <dl className="grid grid-cols-[minmax(7.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm leading-5">
                      {fields.map(({ key, label, emptyValue }) => (
                        <div key={key} className="contents">
                          <dt className="font-semibold text-white/60">{label}</dt>
                          <dd className="min-w-0 whitespace-pre-wrap break-words font-semibold text-white">
                            {displayValue(item[key], emptyValue)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
