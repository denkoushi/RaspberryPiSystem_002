import { useEffect, useRef, useState } from 'react';

import { KioskDigitTenkey } from '../../features/kiosk/KioskDigitTenkey';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';

export type MachineNameCandidateListParams = {
  digitQuery?: string;
  q?: string;
  limit?: number;
};

export type MachineNameCandidateListResult = {
  candidates: string[];
  hasMore: boolean;
};

type Props = {
  isOpen: boolean;
  currentValue: string;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: (machineName: string) => void;
  loadCandidates: (
    params: MachineNameCandidateListParams
  ) => Promise<MachineNameCandidateListResult>;
  /** Assembly は文字検索も使えるが、サイネージ管理 UI は数字テンキーだけにする。 */
  showTextSearch?: boolean;
  title?: string;
  description?: string;
};

const CANDIDATE_LIMIT = 40;
const DEBOUNCE_MS = 200;
const tenkeyClass =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded border border-white/15 bg-slate-950 text-lg font-extrabold text-white hover:bg-slate-800 disabled:opacity-40';
const resetClass =
  'inline-flex h-11 shrink-0 items-center justify-center rounded border border-amber-300/30 bg-slate-950 px-3 text-sm font-extrabold text-amber-200 hover:bg-slate-800 disabled:opacity-40';

export function MachineNamePickerDialog({
  isOpen,
  currentValue,
  disabled = false,
  onCancel,
  onConfirm,
  loadCandidates,
  showTextSearch = true,
  title = '機種名を選択',
  description,
}: Props) {
  const [digitQuery, setDigitQuery] = useState('');
  const [textQuery, setTextQuery] = useState('');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    setDigitQuery('');
    setTextQuery('');
    setCandidates([]);
    setHasMore(false);
    setSelected(null);
    setError(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const sequence = ++requestSequence.current;
    setSelected(null);
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void loadCandidates({
        digitQuery,
        q: showTextSearch ? textQuery : undefined,
        limit: CANDIDATE_LIMIT,
      })
        .then((result) => {
          if (sequence !== requestSequence.current) return;
          setCandidates(result.candidates);
          setHasMore(result.hasMore);
        })
        .catch(() => {
          if (sequence !== requestSequence.current) return;
          setCandidates([]);
          setHasMore(false);
          setError('機種名候補を取得できませんでした。検索条件を確認して、もう一度お試しください。');
        })
        .finally(() => {
          if (sequence === requestSequence.current) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [digitQuery, isOpen, loadCandidates, showTextSearch, textQuery]);

  const close = () => {
    requestSequence.current += 1;
    onCancel();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title={title}
      description={
        description ??
        (showTextSearch
          ? '数字テンキーを主に使い、必要な場合だけ文字条件を追加してください。両方の条件に一致する候補を表示します。'
          : '数字テンキーで機種名候補を絞り込み、一覧から選択してください。文字入力は使用しません。')
      }
      size="lg"
      className="flex min-h-0 flex-col"
    >
      <div className="mt-4 grid min-h-0 gap-4 md:grid-cols-[minmax(20rem,0.9fr)_minmax(18rem,1.1fr)]">
        <section className="grid content-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div>
            <div className="text-sm font-bold text-slate-700">数字検索</div>
            <div className="mt-1 min-h-11 rounded border border-slate-300 bg-white px-3 py-2 text-xl font-bold tracking-wider text-slate-900">
              {digitQuery || <span className="text-slate-400">未指定</span>}
            </div>
          </div>
          <KioskDigitTenkey
            value={digitQuery}
            onChange={setDigitQuery}
            disabled={disabled}
            maxLength={120}
            ariaLabel="機種名数字テンキー"
            className="flex flex-wrap gap-2"
            keyClassName={tenkeyClass}
            resetClassName={resetClass}
          />
          {showTextSearch ? (
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              文字検索（補助）
              <Input
                value={textQuery}
                maxLength={120}
                disabled={disabled}
                placeholder="例: KP"
                aria-label="機種名文字検索"
                onChange={(event) => setTextQuery(event.target.value)}
              />
            </label>
          ) : null}
          <p className="text-xs text-slate-500">
            現在の確定値: <span className="font-semibold text-slate-700">{currentValue || '未選択'}</span>
          </p>
        </section>

        <section className="flex min-h-[18rem] flex-col overflow-hidden rounded-lg border border-slate-200">
          <div className="flex min-h-11 items-center justify-between border-b border-slate-200 bg-slate-50 px-3">
            <span className="text-sm font-bold text-slate-700">候補</span>
            <span className="text-xs font-semibold text-slate-500">{loading ? '検索中…' : `${candidates.length}件`}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-live="polite">
            {loading ? (
              <div className="flex min-h-40 items-center justify-center text-sm font-semibold text-slate-500">候補を検索中…</div>
            ) : error ? (
              <div role="alert" className="rounded border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>
            ) : candidates.length === 0 ? (
              <div className="flex min-h-40 items-center justify-center text-sm font-semibold text-slate-500">一致する機種名はありません。</div>
            ) : (
              <div className="grid gap-1">
                {candidates.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className={`min-h-11 rounded border px-3 py-2 text-left text-base font-bold ${
                      selected === candidate
                        ? 'border-cyan-600 bg-cyan-50 text-cyan-950 ring-2 ring-cyan-300'
                        : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
                    }`}
                    aria-pressed={selected === candidate}
                    onClick={() => setSelected(candidate)}
                  >
                    {candidate}
                  </button>
                ))}
              </div>
            )}
          </div>
          {hasMore ? (
            <p className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              40件を超えています。数字または文字を追加して絞り込んでください。
            </p>
          ) : null}
        </section>
      </div>

      <div className="mt-4 flex shrink-0 justify-end gap-2">
        <Button type="button" variant="secondary" disabled={disabled} onClick={close}>
          キャンセル
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={disabled || !selected}
          onClick={() => {
            if (selected) onConfirm(selected);
          }}
        >
          この機種名を使用
        </Button>
      </div>
    </Dialog>
  );
}
