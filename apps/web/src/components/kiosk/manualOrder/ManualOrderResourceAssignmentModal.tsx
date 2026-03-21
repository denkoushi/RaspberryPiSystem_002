import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS } from '../../../features/kiosk/manualOrder/manualOrderOverviewTypography';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  deviceLabel: string;
  candidateResourceCds: string[];
  resourceNameMap: Record<string, string[]>;
  /** サーバーからのこの端末の割り当て（モーダル表示時に同期） */
  initialResourceCds: string[];
  isSaving: boolean;
  saveError: string | null;
  onSave: (resourceCds: string[]) => void;
  /** 他端末で使用中のときはその端末の表示名（deviceScopeKey） */
  resolveInUseByOther: (resourceCd: string) => string | undefined;
};

function formatResourceLine(cd: string, resourceNameMap: Record<string, string[]>): string {
  const names = resourceNameMap[cd] ?? [];
  return names.length > 0 ? `${cd}（${names.join(' / ')}）` : cd;
}

export function ManualOrderResourceAssignmentModal({
  isOpen,
  onClose,
  deviceLabel,
  candidateResourceCds,
  resourceNameMap,
  initialResourceCds,
  isSaving,
  saveError,
  onSave,
  resolveInUseByOther
}: Props) {
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setSelected([...initialResourceCds]);
  }, [isOpen, initialResourceCds]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const addCd = useCallback(
    (cd: string) => {
      const other = resolveInUseByOther(cd);
      if (other) return;
      if (selectedSet.has(cd)) return;
      setSelected((prev) => [...prev, cd]);
    },
    [resolveInUseByOther, selectedSet]
  );

  const removeAt = useCallback((index: number) => {
    setSelected((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const move = useCallback((index: number, delta: number) => {
    setSelected((prev) => {
      const next = index + delta;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      const t = copy[index]!;
      copy[index] = copy[next]!;
      copy[next] = t;
      return copy;
    });
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-order-resource-modal-title"
    >
      <div
        className={clsx(
          'flex max-h-[min(90vh,720px)] w-full max-w-3xl flex-col rounded-lg border border-white/15 bg-slate-900 shadow-xl',
          KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS
        )}
      >
        <div className="border-b border-white/10 px-4 py-3">
          <h2 id="manual-order-resource-modal-title" className="text-sm font-semibold text-cyan-200">
            資源の割り当て
          </h2>
          <p className="mt-1 text-xs text-white/55">{deviceLabel}</p>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 md:grid-cols-2">
          <div className="flex min-h-0 flex-col rounded border border-white/10 bg-slate-950/50">
            <p className="border-b border-white/10 px-3 py-2 text-xs font-semibold text-white/70">候補</p>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <ul className="space-y-1">
                {candidateResourceCds.map((cd) => {
                  const inUse = resolveInUseByOther(cd);
                  const chosen = selectedSet.has(cd);
                  const disabled = Boolean(inUse) || chosen;
                  return (
                    <li key={cd}>
                      <button
                        type="button"
                        disabled={disabled || isSaving}
                        onClick={() => addCd(cd)}
                        className={clsx(
                          'w-full rounded px-2 py-1.5 text-left text-xs',
                          disabled
                            ? 'cursor-not-allowed text-white/35'
                            : 'text-white hover:bg-white/10'
                        )}
                      >
                        <span className="font-mono">{formatResourceLine(cd, resourceNameMap)}</span>
                        {inUse ? (
                          <span className="ml-2 text-amber-200/90">使用中（{inUse}）</span>
                        ) : null}
                        {chosen && !inUse ? (
                          <span className="ml-2 text-white/40">選択済み</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="flex min-h-0 flex-col rounded border border-white/10 bg-slate-950/50">
            <p className="border-b border-white/10 px-3 py-2 text-xs font-semibold text-white/70">
              割り当て順（上が優先）
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {selected.length === 0 ? (
                <p className="px-2 py-4 text-xs text-white/45">左から資源を追加してください。</p>
              ) : (
                <ul className="space-y-1">
                  {selected.map((cd, index) => (
                    <li
                      key={`${cd}-${index}`}
                      className="flex items-center gap-1 rounded bg-slate-800/80 px-2 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-white">
                        {formatResourceLine(cd, resourceNameMap)}
                      </span>
                      <button
                        type="button"
                        disabled={isSaving || index === 0}
                        onClick={() => move(index, -1)}
                        className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/80 disabled:opacity-30"
                        aria-label={`${cd} を上へ`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={isSaving || index === selected.length - 1}
                        onClick={() => move(index, 1)}
                        className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/80 disabled:opacity-30"
                        aria-label={`${cd} を下へ`}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => removeAt(index)}
                        className="shrink-0 rounded border border-rose-500/40 px-1.5 py-0.5 text-[10px] text-rose-200"
                        aria-label={`${cd} を外す`}
                      >
                        外す
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {saveError ? <p className="px-4 text-xs text-rose-300">{saveError}</p> : null}

        <div className="flex justify-end gap-2 border-t border-white/10 px-4 py-3">
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="rounded border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10"
          >
            閉じる
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => onSave(selected)}
            className="rounded border border-cyan-500/50 bg-cyan-600/30 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-600/45 disabled:opacity-50"
          >
            {isSaving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
