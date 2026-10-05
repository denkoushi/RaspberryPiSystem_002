import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ingestProcedureMaterialsGmail } from '../../../api/client';
import { useBackupConfig, useBackupConfigMutations, useCsvImportSchedules, useCsvImportScheduleMutations } from '../../../api/hooks';
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
  const backupConfigQuery = useBackupConfig();
  const backupConfigMutations = useBackupConfigMutations();
  const [domainInput, setDomainInput] = useState('');
  const [domainMessage, setDomainMessage] = useState<string | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [savingDomains, setSavingDomains] = useState(false);
  const domains = backupConfigQuery.data?.procedureMaterialGmailIngest?.allowedSenderDomains ?? ['thkintechs.co.jp'];
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

  const saveDomain = async (domain: string, remove = false) => {
    setDomainError(null);
    setDomainMessage(null);
    if (!remove) {
      if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
        setDomainError('ドメインの形式が不正です');
        return;
      }
      if (domains.includes(domain)) {
        setDomainError('登録済みです');
        return;
      }
    }
    if (remove && domains.length === 1 && !confirm('全ての送信元を拒否します')) return;
    setSavingDomains(true);
    try {
      // PUT replaces the config: fetch current settings so schedule edits are preserved.
      const latest = await backupConfigQuery.refetch();
      if (latest.isError || !latest.data) throw new Error('設定を取得できません');
      const config = latest.data;
      const current = config.procedureMaterialGmailIngest ?? { enabled: false, subjectTokens: [DEFAULT_SUBJECT_TOKEN], allowedSenderDomains: ['thkintechs.co.jp'] };
      const currentDomains = current.allowedSenderDomains ?? ['thkintechs.co.jp'];
      if (!remove && currentDomains.includes(domain)) throw new Error('登録済みです');
      await backupConfigMutations.updateConfig.mutateAsync({
        ...config,
        procedureMaterialGmailIngest: {
          ...current,
          allowedSenderDomains: remove ? currentDomains.filter((entry) => entry !== domain) : [...currentDomains, domain],
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['csv-import-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['backup-config'] }),
        queryClient.invalidateQueries({ queryKey: ['backup-config-health'] }),
      ]);
      if (!remove) setDomainInput('');
      setDomainMessage('保存しました');
    } catch (error) {
      setDomainError(errorText(error));
    } finally { setSavingDomains(false); }
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

      <div className="mt-3 border-t border-slate-200 pt-3">
        <h4 className="text-sm font-semibold text-slate-700">許可する送信元ドメイン</h4>
        {backupConfigQuery.isLoading ? <p className="text-sm text-slate-500">設定を読み込み中...</p> : backupConfigQuery.isError || !backupConfigQuery.data ? (
          <p className="text-sm text-amber-700" role="alert">設定を取得できません</p>
        ) : (
          <>
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="許可する送信元ドメイン">
              {domains.map((domain) => (
                <li key={domain} className="flex items-center gap-1 rounded-full border border-slate-300 bg-white pl-3 text-sm">
                  <span>{domain}</span>
                  <Button className="min-h-11" variant="ghost" aria-label={`${domain}を削除`} disabled={savingDomains || scheduleMutations.update.isPending} onClick={() => void saveDomain(domain, true)}>削除</Button>
                </li>
              ))}
            </ul>
            {domains.length === 0 ? <p className="mt-2 text-sm text-amber-700">全ての送信元を拒否します</p> : null}
            <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(event) => {
              event.preventDefault();
              void saveDomain(domainInput.trim().toLowerCase().replace(/^@/, ''));
            }}>
              <label htmlFor="procedure-material-sender-domain" className="text-sm">ドメインを追加</label>
              <input id="procedure-material-sender-domain" className="min-h-11 rounded border border-slate-300 px-3" placeholder="example.co.jp" value={domainInput} onChange={(event) => { setDomainInput(event.target.value); setDomainError(null); setDomainMessage(null); }} disabled={savingDomains || scheduleMutations.update.isPending} />
              <Button className="min-h-11" type="submit" variant="secondary" disabled={savingDomains || scheduleMutations.update.isPending}>追加</Button>
            </form>
            {domainMessage ? <p className="mt-2 text-sm text-emerald-700" role="status">{domainMessage}</p> : null}
            {domainError ? <p className="mt-2 text-sm text-red-700" role="alert">{domainError}</p> : null}
          </>
        )}
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
                disabled={scheduleMutations.update.isPending || savingDomains}
              />
              自動取込を有効にする
            </label>
            <Button variant="ghost" onClick={() => void save()} disabled={scheduleMutations.update.isPending || savingDomains}>
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
