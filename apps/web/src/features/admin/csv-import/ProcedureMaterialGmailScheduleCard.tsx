import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ingestProcedureMaterialsGmail } from '../../../api/client';
import { useCsvImportSchedules, useCsvImportScheduleMutations } from '../../../api/hooks';
import { Button } from '../../../components/ui/Button';

const DEFAULT_SUBJECT_TOKEN = '[Procedure-material]';

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (message) return message;
  }
  return error instanceof Error ? error.message : '処理に失敗しました';
}

export function ProcedureMaterialGmailScheduleCard() {
  const schedulesQuery = useCsvImportSchedules();
  const scheduleMutations = useCsvImportScheduleMutations();
  const queryClient = useQueryClient();
  const schedule = schedulesQuery.data?.schedules.find((row) => row.targets?.some((target) => target.type === 'procedureMaterialGmail'));
  const [running, setRunning] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const configured = schedule?.enabled;
    setEnabled(typeof configured === 'boolean' ? configured : false);
  }, [schedule?.enabled]);

  const save = async () => {
    if (!schedule || schedulesQuery.isError) {
      setSaveMessage('設定を取得できないため保存できません');
      return;
    }

    setErrorMessage(null);
    setSaveMessage(null);
    try {
      await scheduleMutations.update.mutateAsync({ id: schedule.id, schedule: { enabled } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['backup-config'] }),
        queryClient.invalidateQueries({ queryKey: ['backup-config-health'] }),
      ]);
      setSaveMessage(`保存しました（${enabled ? '有効' : '無効'}）`);
    } catch (error) {
      setSaveMessage(null);
      setErrorMessage(errorText(error));
    }
  };

  const runNow = async () => {
    setErrorMessage(null);
    setRunMessage(null);
    setRunning(true);
    try {
      const result = await ingestProcedureMaterialsGmail();
      setRunMessage(`取込 ${result.saved}件・保存済み ${result.duplicate}件・スキップ ${result.skipped}通・再試行 ${result.retryable}通`);
    } catch (error) {
      setErrorMessage(errorText(error));
    } finally { setRunning(false); }
  };

  return (
    <section className="mb-4 rounded-lg border border-slate-300 bg-slate-50 p-3" aria-labelledby="procedure-material-gmail-schedule-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="procedure-material-gmail-schedule-heading" className="font-bold">要領書の素材(Gmail)</h3>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            件名を「{DEFAULT_SUBJECT_TOKEN}」で始めて送ると、本文と写真を素材棚に取り込みます。保存したメールはゴミ箱へ移します。
          </p>
        </div>
        <Button variant="secondary" onClick={() => void runNow()} disabled={running}>
          {running ? '確認中...' : '今すぐ取り込む'}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200 pt-3">
        <span className="text-sm font-semibold text-slate-700">実行間隔: 5分ごと（既定）</span>
        {schedulesQuery.isLoading ? <span className="text-sm text-slate-500">設定を読み込み中...</span> : schedulesQuery.isError || !schedule ? (
          <span className="text-sm text-amber-700" role="alert">設定を取得できないため、ON/OFFの保存は無効です。</span>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                aria-label="要領書の素材自動取込"
                checked={enabled}
                onChange={(event) => {
                  setEnabled(event.target.checked);
                  setSaveMessage(null);
                }}
                disabled={scheduleMutations.update.isPending}
              />
              自動取込を有効にする
            </label>
            <Button variant="ghost" onClick={() => void save()} disabled={scheduleMutations.update.isPending}>
              {scheduleMutations.update.isPending ? '保存中...' : '設定を保存'}
            </Button>
            {saveMessage ? <span className="text-sm text-emerald-700" role="status">{saveMessage}</span> : null}
          </>
        )}
        {runMessage ? <span className="text-sm text-emerald-700" role="status">{runMessage}</span> : null}
        {errorMessage ? <span className="text-sm text-red-700" role="alert">{errorMessage}</span> : null}
      </div>
    </section>
  );
}
