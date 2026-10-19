import { useEffect, useState } from 'react';

import { useBackupConfig, useBackupConfigMutations, useInventoryMutations } from '../../../api/hooks';
import { Button } from '../../../components/ui/Button';

import type { BackupConfig } from '../../../api/backup';

const DEFAULT_SUBJECT_TOKEN = '[ItemlistRaspi-photo]';

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (message) return message;
  }
  return error instanceof Error ? error.message : '処理に失敗しました';
}

export function ItemInventoryGmailScheduleCard() {
  const backupConfigQuery = useBackupConfig();
  const backupConfigMutations = useBackupConfigMutations();
  const inventoryMutations = useInventoryMutations();
  const [enabled, setEnabled] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const configured = backupConfigQuery.data?.itemInventoryGmailIngest?.enabled;
    setEnabled(typeof configured === 'boolean' ? configured : false);
  }, [backupConfigQuery.data]);

  const save = async () => {
    const config = backupConfigQuery.data;
    if (!config || backupConfigQuery.isError) {
      setSaveMessage('設定を取得できないため保存できません');
      return;
    }

    setErrorMessage(null);
    setSaveMessage(null);
    try {
      const current = config.itemInventoryGmailIngest;
      const itemInventoryGmailIngest: NonNullable<BackupConfig['itemInventoryGmailIngest']> = current
        ? { ...current, enabled }
        : { enabled, subjectTokens: [DEFAULT_SUBJECT_TOKEN] };
      await backupConfigMutations.updateConfig.mutateAsync({
        ...config,
        itemInventoryGmailIngest,
      });
      setSaveMessage(`保存しました（${enabled ? '有効' : '無効'}）`);
    } catch (error) {
      setSaveMessage(null);
      setErrorMessage(errorText(error));
    }
  };

  const runNow = async () => {
    setErrorMessage(null);
    setRunMessage(null);
    try {
      await inventoryMutations.ingest.mutateAsync(undefined);
      setRunMessage('手動確認を実行しました');
    } catch (error) {
      setErrorMessage(errorText(error));
    }
  };

  return (
    <section className="mb-4 rounded-lg border border-slate-300 bg-slate-50 p-3" aria-labelledby="item-inventory-gmail-schedule-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="item-inventory-gmail-schedule-heading" className="font-bold">Raspberry Pi在庫写真メール取込</h3>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            CSVスケジュールとは別に、件名トークン「{DEFAULT_SUBJECT_TOKEN}」のJSON＋JPEGを在庫取込として処理します。
          </p>
        </div>
        <Button variant="secondary" onClick={() => void runNow()} disabled={inventoryMutations.ingest.isPending}>
          {inventoryMutations.ingest.isPending ? '確認中...' : '在庫写真メールを今すぐ確認'}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200 pt-3">
        <span className="text-sm font-semibold text-slate-700">実行間隔: 5分ごと（固定）</span>
        {backupConfigQuery.isLoading ? <span className="text-sm text-slate-500">設定を読み込み中...</span> : backupConfigQuery.isError || !backupConfigQuery.data ? (
          <span className="text-sm text-amber-700" role="alert">設定を取得できないため、ON/OFFの保存は無効です。</span>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                aria-label="在庫写真メール自動取込"
                checked={enabled}
                onChange={(event) => {
                  setEnabled(event.target.checked);
                  setSaveMessage(null);
                }}
                disabled={backupConfigMutations.updateConfig.isPending}
              />
              自動取込を有効にする
            </label>
            <Button variant="ghost" onClick={() => void save()} disabled={backupConfigMutations.updateConfig.isPending}>
              {backupConfigMutations.updateConfig.isPending ? '保存中...' : '設定を保存'}
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
