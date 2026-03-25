import { FormEvent, useState } from 'react';

import { useKioskDocumentMutations, useKioskDocuments } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

import type { KioskDocumentSummary } from '../../api/client';

export function KioskDocumentsAdminPage() {
  const listQuery = useKioskDocuments({ hideDisabled: false });
  const { upload, remove, setEnabled, ingestGmail } = useKioskDocumentMutations();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [ingestMessage, setIngestMessage] = useState<string | null>(null);

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      alert('PDFを選択してください');
      return;
    }
    await upload.mutateAsync({ file, title: title.trim() || undefined });
    setFile(null);
    setTitle('');
  };

  const handleDelete = async (id: string) => {
    if (confirm('この要領書を削除しますか？')) {
      await remove.mutateAsync(id);
    }
  };

  const handleIngest = async () => {
    setIngestMessage(null);
    try {
      const results = await ingestGmail.mutateAsync(scheduleId.trim() ? { scheduleId: scheduleId.trim() } : undefined);
      setIngestMessage(`完了: ${JSON.stringify(results)}`);
    } catch (err) {
      setIngestMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">要領書（キオスク）</h1>
      <Card title="PDFアップロード（手動）">
        <form onSubmit={(e) => void handleUpload(e)} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700">PDF</label>
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700">表示タイトル（任意）</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="省略時はファイル名から生成"
            />
          </div>
          <Button type="submit" disabled={upload.isPending}>
            {upload.isPending ? 'アップロード中…' : 'アップロード'}
          </Button>
        </form>
      </Card>

      <Card title="Gmailから取り込み（手動実行）">
        <p className="mb-3 text-sm text-slate-600">
          backup.json の <code className="rounded bg-slate-100 px-1">kioskDocumentGmailIngest</code> と{' '}
          <code className="rounded bg-slate-100 px-1">storage.provider=gmail</code> が必要です。スケジュールIDを空にすると有効な全スケジュールを実行します。
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-semibold text-slate-600">スケジュールID（任意）</label>
            <input
              type="text"
              value={scheduleId}
              onChange={(e) => setScheduleId(e.target.value)}
              className="mt-1 w-64 rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="例: kiosk-docs-gmail-1"
            />
          </div>
          <Button type="button" onClick={() => void handleIngest()} disabled={ingestGmail.isPending}>
            {ingestGmail.isPending ? '実行中…' : '取り込み実行'}
          </Button>
        </div>
        {ingestMessage ? <p className="mt-2 text-xs text-slate-700 break-all">{ingestMessage}</p> : null}
      </Card>

      <Card title="登録一覧">
        {listQuery.isLoading ? (
          <p className="text-sm text-slate-600">読み込み中…</p>
        ) : listQuery.isError ? (
          <p className="text-sm text-red-600">取得に失敗しました</p>
        ) : !listQuery.data?.length ? (
          <p className="text-sm text-slate-600">登録がありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-3 py-2 font-semibold">タイトル</th>
                  <th className="px-3 py-2 font-semibold">ファイル</th>
                  <th className="px-3 py-2 font-semibold">取込元</th>
                  <th className="px-3 py-2 font-semibold">状態</th>
                  <th className="px-3 py-2 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.data.map((doc: KioskDocumentSummary) => (
                  <tr key={doc.id} className="border-b border-slate-100">
                    <td className="px-3 py-2">{doc.title}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{doc.sourceAttachmentName || doc.filename}</td>
                    <td className="px-3 py-2">{doc.sourceType === 'GMAIL' ? 'Gmail' : '手動'}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className={`rounded px-2 py-1 text-xs font-semibold ${
                          doc.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                        }`}
                        onClick={() => void setEnabled.mutateAsync({ id: doc.id, enabled: !doc.enabled })}
                      >
                        {doc.enabled ? '有効' : '無効'}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-red-600"
                        onClick={() => void handleDelete(doc.id)}
                      >
                        削除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
