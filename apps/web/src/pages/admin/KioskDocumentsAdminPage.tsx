import { FormEvent, useMemo, useState } from 'react';

import { useBackupConfig, useKioskDocumentMutations, useKioskDocuments } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { KioskGmailIngestScheduleListSection } from '../../features/admin/kiosk-gmail-ingest-schedules/KioskGmailIngestScheduleListSection';

import type { KioskDocumentSummary } from '../../api/client';

export function KioskDocumentsAdminPage() {
  const [search, setSearch] = useState('');
  const [ocrStatus, setOcrStatus] = useState<'' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'>('');
  const [includeCandidates, setIncludeCandidates] = useState(false);
  const listQuery = useKioskDocuments({
    hideDisabled: false,
    q: search || undefined,
    ocrStatus: ocrStatus || undefined,
    includeCandidates,
  });
  const backupConfigQuery = useBackupConfig();
  const { upload, remove, setEnabled, patchMetadata, reprocess, ingestGmail } = useKioskDocumentMutations();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [ingestMessage, setIngestMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [displayTitle, setDisplayTitle] = useState('');
  const [confirmedFhincd, setConfirmedFhincd] = useState('');
  const [confirmedDrawingNumber, setConfirmedDrawingNumber] = useState('');
  const [confirmedProcessName, setConfirmedProcessName] = useState('');
  const [confirmedResourceCd, setConfirmedResourceCd] = useState('');
  const [confirmedDocumentNumber, setConfirmedDocumentNumber] = useState('');
  const [confirmedSummaryText, setConfirmedSummaryText] = useState('');
  const [documentCategory, setDocumentCategory] = useState('');

  const documents = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const selected = useMemo(
    () => documents.find((d) => d.id === selectedId) ?? null,
    [documents, selectedId]
  );

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

  const selectForEdit = (doc: KioskDocumentSummary) => {
    setSelectedId(doc.id);
    setDisplayTitle(doc.displayTitle ?? doc.title);
    setConfirmedFhincd(doc.confirmedFhincd ?? '');
    setConfirmedDrawingNumber(doc.confirmedDrawingNumber ?? '');
    setConfirmedProcessName(doc.confirmedProcessName ?? '');
    setConfirmedResourceCd(doc.confirmedResourceCd ?? '');
    setConfirmedDocumentNumber(doc.confirmedDocumentNumber ?? '');
    setConfirmedSummaryText(doc.confirmedSummaryText ?? '');
    setDocumentCategory(doc.documentCategory ?? '');
  };

  const handleSaveMetadata = async () => {
    if (!selectedId) return;
    await patchMetadata.mutateAsync({
      id: selectedId,
      payload: {
        displayTitle: displayTitle.trim() || null,
        confirmedFhincd: confirmedFhincd.trim() || null,
        confirmedDrawingNumber: confirmedDrawingNumber.trim() || null,
        confirmedProcessName: confirmedProcessName.trim() || null,
        confirmedResourceCd: confirmedResourceCd.trim() || null,
        confirmedDocumentNumber: confirmedDocumentNumber.trim() || null,
        confirmedSummaryText: confirmedSummaryText.trim() || null,
        documentCategory: documentCategory.trim() || null,
      },
    });
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

      <KioskGmailIngestScheduleListSection
        schedulesRaw={backupConfigQuery.data?.kioskDocumentGmailIngest}
        isLoading={backupConfigQuery.isLoading}
        isError={backupConfigQuery.isError}
        onUseScheduleId={(id) => setScheduleId(id)}
      />

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
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-semibold text-slate-600">検索</label>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1 w-72 rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="タイトル・本文・文書番号・要約で検索"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">抽出ステータス</label>
            <select
              value={ocrStatus}
              onChange={(e) =>
                setOcrStatus(e.target.value as '' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED')
              }
              className="mt-1 rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">すべて</option>
              <option value="PENDING">抽出待ち</option>
              <option value="PROCESSING">処理中</option>
              <option value="COMPLETED">完了</option>
              <option value="FAILED">失敗</option>
            </select>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={includeCandidates}
              onChange={(e) => setIncludeCandidates(e.target.checked)}
            />
            候補値も検索対象に含める（詳細検索）
          </label>
        </div>
        {listQuery.isLoading ? (
          <p className="text-sm text-slate-600">読み込み中…</p>
        ) : listQuery.isError ? (
          <p className="text-sm text-red-600">取得に失敗しました</p>
        ) : !documents.length ? (
          <p className="text-sm text-slate-600">登録がありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1220px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-3 py-2 font-semibold">タイトル</th>
                  <th className="px-3 py-2 font-semibold">文書番号</th>
                  <th className="px-3 py-2 font-semibold">FHINCD</th>
                  <th className="px-3 py-2 font-semibold">図面番号</th>
                  <th className="px-3 py-2 font-semibold">要約</th>
                  <th className="px-3 py-2 font-semibold">カテゴリ</th>
                  <th className="px-3 py-2 font-semibold">抽出</th>
                  <th className="px-3 py-2 font-semibold">状態</th>
                  <th className="px-3 py-2 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc: KioskDocumentSummary) => (
                  <tr key={doc.id} className="border-b border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-medium">{doc.displayTitle || doc.title}</div>
                      <div className="text-xs text-slate-500">{doc.sourceAttachmentName || doc.filename}</div>
                    </td>
                    <td className="px-3 py-2">{doc.confirmedDocumentNumber || '-'}</td>
                    <td className="px-3 py-2">{doc.confirmedFhincd || '-'}</td>
                    <td className="px-3 py-2">{doc.confirmedDrawingNumber || '-'}</td>
                    <td className="px-3 py-2">
                      <div className="line-clamp-2 max-w-md text-xs text-slate-700">
                        {doc.confirmedSummaryText ||
                          doc.summaryCandidate1 ||
                          doc.summaryCandidate2 ||
                          doc.summaryCandidate3 ||
                          '-'}
                      </div>
                    </td>
                    <td className="px-3 py-2">{doc.documentCategory || '-'}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-slate-100 px-2 py-1 text-xs">{doc.ocrStatus}</span>
                    </td>
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
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="ghost" onClick={() => selectForEdit(doc)}>
                          編集
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => void reprocess.mutateAsync(doc.id)}
                          disabled={reprocess.isPending}
                        >
                          再処理
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-red-600"
                          onClick={() => void handleDelete(doc.id)}
                        >
                          削除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="メタデータ編集（候補確認 + 確定値）">
        {!selected ? (
          <p className="text-sm text-slate-600">一覧の「編集」から対象ドキュメントを選択してください。</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded bg-slate-50 p-3 text-sm">
              <div className="font-semibold">{selected.displayTitle || selected.title}</div>
              <div className="text-xs text-slate-500">
                候補: 文書番号={selected.candidateDocumentNumber || '-'} (信頼度 {selected.confidenceDocumentNumber ?? 0})
              </div>
              <div className="text-xs text-slate-500">候補: FHINCD={selected.candidateFhincd || '-'} (信頼度 {selected.confidenceFhincd ?? 0})</div>
              <div className="text-xs text-slate-500">候補: 図面番号={selected.candidateDrawingNumber || '-'} (信頼度 {selected.confidenceDrawingNumber ?? 0})</div>
              <div className="text-xs text-slate-500">候補: 工程={selected.candidateProcessName || '-'} (信頼度 {selected.confidenceProcessName ?? 0})</div>
              <div className="text-xs text-slate-500">候補: 資源CD={selected.candidateResourceCd || '-'} (信頼度 {selected.confidenceResourceCd ?? 0})</div>
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">OCR本文（折りたたみ）</summary>
              <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-100">
                {selected.extractedText || '(抽出本文なし)'}
              </pre>
            </details>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <input className="rounded border border-slate-300 px-3 py-2 text-sm" value={displayTitle} onChange={(e) => setDisplayTitle(e.target.value)} placeholder="表示タイトル" />
              <div className="flex items-center gap-2">
                <input
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={confirmedDocumentNumber}
                  onChange={(e) => setConfirmedDocumentNumber(e.target.value)}
                  placeholder="確定 文書番号（例: 産1-G025AAK）"
                />
                {selected.candidateDocumentNumber ? (
                  <Button type="button" variant="ghost" onClick={() => setConfirmedDocumentNumber(selected.candidateDocumentNumber || '')}>
                    候補採用
                  </Button>
                ) : null}
              </div>
              <input className="rounded border border-slate-300 px-3 py-2 text-sm" value={confirmedFhincd} onChange={(e) => setConfirmedFhincd(e.target.value)} placeholder="確定 FHINCD" />
              <input className="rounded border border-slate-300 px-3 py-2 text-sm" value={confirmedDrawingNumber} onChange={(e) => setConfirmedDrawingNumber(e.target.value)} placeholder="確定 図面番号" />
              <input className="rounded border border-slate-300 px-3 py-2 text-sm" value={confirmedProcessName} onChange={(e) => setConfirmedProcessName(e.target.value)} placeholder="確定 工程名" />
              <input className="rounded border border-slate-300 px-3 py-2 text-sm" value={confirmedResourceCd} onChange={(e) => setConfirmedResourceCd(e.target.value)} placeholder="確定 資源CD" />
              <input className="rounded border border-slate-300 px-3 py-2 text-sm" value={documentCategory} onChange={(e) => setDocumentCategory(e.target.value)} placeholder="カテゴリ" />
            </div>
            <div className="space-y-2 rounded border border-slate-200 p-3">
              <p className="text-xs font-semibold text-slate-700">要約候補（候補を選んで確定可能）</p>
              {[selected.summaryCandidate1, selected.summaryCandidate2, selected.summaryCandidate3]
                .filter((v): v is string => Boolean(v && v.trim().length > 0))
                .map((candidate, idx) => (
                  <label key={`${candidate}-${idx}`} className="flex cursor-pointer items-start gap-2 rounded bg-slate-50 p-2 text-sm">
                    <input
                      type="radio"
                      name="summary-candidate"
                      checked={confirmedSummaryText === candidate}
                      onChange={() => setConfirmedSummaryText(candidate)}
                    />
                    <span>{candidate}</span>
                  </label>
                ))}
              <textarea
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                rows={3}
                value={confirmedSummaryText}
                onChange={(e) => setConfirmedSummaryText(e.target.value)}
                placeholder="確定 要約（候補を編集可）"
              />
            </div>
            <Button type="button" onClick={() => void handleSaveMetadata()} disabled={patchMetadata.isPending}>
              {patchMetadata.isPending ? '保存中…' : '確定値を保存'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
