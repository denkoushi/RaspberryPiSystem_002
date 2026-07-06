import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import {
  getAssemblyProcedureOrder,
  getKioskDocuments,
  saveAssemblyProcedureOrder,
  verifyAssemblyProcedureOrderAccessPassword
} from '../../api/client';
import { Button, buttonClassName } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  KIOSK_ASSEMBLY_HOME_PATH,
  KIOSK_ASSEMBLY_LIBRARY_PATH,
  parseAssemblyProcedureOrderSettingsSearch,
  readAssemblyApiErrorMessage
} from '../../features/assembly';

import type { KioskDocumentSummary } from '../../api/client';
import type { AssemblyProcedureOrderDto } from '../../features/assembly/types';

type DraftItem = {
  kioskDocumentId: string;
  label: string;
  document: KioskDocumentSummary;
};

function toHalfWidthAscii(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

function normalizeMachineName(value: string): string {
  return toHalfWidthAscii(value).trim().toUpperCase().slice(0, 120);
}

function documentTitle(document: Pick<KioskDocumentSummary, 'displayTitle' | 'title' | 'confirmedDocumentNumber'>): string {
  const number = document.confirmedDocumentNumber?.trim();
  const title = document.displayTitle?.trim() || document.title;
  return number ? `${number} ${title}` : title;
}

function orderToDraft(order: AssemblyProcedureOrderDto): DraftItem[] {
  return order.items.map((item) => ({
    kioskDocumentId: item.kioskDocumentId,
    label: item.label ?? '',
    document: {
      ...item.document,
      extractedText: null,
      ocrStatus: 'COMPLETED',
      ocrEngine: null,
      ocrStartedAt: null,
      ocrFinishedAt: null,
      ocrRetryCount: 0,
      ocrFailureReason: null,
      candidateFhincd: null,
      candidateDrawingNumber: null,
      candidateProcessName: null,
      candidateResourceCd: null,
      candidateDocumentNumber: null,
      summaryCandidate1: null,
      summaryCandidate2: null,
      summaryCandidate3: null,
      confidenceFhincd: null,
      confidenceDrawingNumber: null,
      confidenceProcessName: null,
      confidenceResourceCd: null,
      confidenceDocumentNumber: null,
      confirmedFhincd: null,
      confirmedDrawingNumber: null,
      confirmedProcessName: null,
      confirmedResourceCd: null,
      documentCategory: null,
      sourceType: 'MANUAL',
      gmailMessageId: null,
      sourceAttachmentName: null,
      createdAt: item.document.updatedAt
    }
  }));
}

export function KioskAssemblyProcedureOrderSettingsPage() {
  const location = useLocation();
  const initialMachineName = useMemo(
    () => parseAssemblyProcedureOrderSettingsSearch(location.search).machineName ?? '',
    [location.search]
  );
  const [pin, setPin] = useState('');
  const [accessPassword, setAccessPassword] = useState<string | null>(null);
  const [machineName, setMachineName] = useState(() => normalizeMachineName(initialMachineName));
  const [loadedMachineName, setLoadedMachineName] = useState('');
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [documentSearch, setDocumentSearch] = useState('');
  const [documents, setDocuments] = useState<KioskDocumentSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const accessGranted = accessPassword != null;
  const normalizedMachineName = useMemo(() => normalizeMachineName(machineName), [machineName]);
  const canSave = accessGranted && normalizedMachineName.length > 0 && !busy;

  const loadOrder = useCallback(
    async (targetMachineName: string) => {
      if (!targetMachineName.trim()) return;
      setBusy(true);
      setMessage(null);
      try {
        const order = await getAssemblyProcedureOrder(targetMachineName);
        setDraftItems(orderToDraft(order));
        setLoadedMachineName(order.machineName);
        setMachineName(order.machineName);
      } catch (error: unknown) {
        setMessage(readAssemblyApiErrorMessage(error, '閲覧順設定の取得に失敗しました。'));
      } finally {
        setBusy(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!accessGranted) return;
    const timer = window.setTimeout(() => {
      void getKioskDocuments({
        q: documentSearch.trim() || undefined,
        hideDisabled: true
      })
        .then(setDocuments)
        .catch((error: unknown) => setMessage(readAssemblyApiErrorMessage(error, '要領書一覧の取得に失敗しました。')));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [accessGranted, documentSearch]);

  useEffect(() => {
    if (!accessGranted || !normalizedMachineName || loadedMachineName === normalizedMachineName) return;
    const timer = window.setTimeout(() => {
      void loadOrder(normalizedMachineName);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [accessGranted, loadOrder, loadedMachineName, normalizedMachineName]);

  const verifyPin = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await verifyAssemblyProcedureOrderAccessPassword({ password: pin });
      if (!result.success) {
        setMessage('パスワードが違います。');
        return;
      }
      setAccessPassword(pin);
      setPin('');
      if (normalizedMachineName) {
        await loadOrder(normalizedMachineName);
      }
    } catch (error: unknown) {
      setMessage(readAssemblyApiErrorMessage(error, '認証に失敗しました。'));
    } finally {
      setBusy(false);
    }
  };

  const addDocument = (document: KioskDocumentSummary) => {
    setDraftItems((current) => [
      ...current,
      {
        kioskDocumentId: document.id,
        label: '',
        document
      }
    ]);
  };

  const moveItem = (index: number, delta: -1 | 1) => {
    setDraftItems((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const saveOrder = async () => {
    if (!accessPassword) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveAssemblyProcedureOrder({
        machineName: normalizedMachineName,
        accessPassword,
        items: draftItems.map((item) => ({
          kioskDocumentId: item.kioskDocumentId,
          label: item.label.trim() || null
        }))
      });
      setDraftItems(orderToDraft(saved));
      setLoadedMachineName(saved.machineName);
      setMachineName(saved.machineName);
      setMessage('閲覧順設定を保存しました。');
    } catch (error: unknown) {
      setMessage(readAssemblyApiErrorMessage(error, '閲覧順設定の保存に失敗しました。'));
    } finally {
      setBusy(false);
    }
  };

  if (!accessGranted) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 bg-slate-800 p-3 text-white">
        <div className="rounded border border-white/15 bg-slate-900/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">組立 閲覧順設定</h1>
              <p className="mt-1 text-sm font-semibold text-white/65">設定変更にはパスワード認証が必要です。</p>
            </div>
            <Link to={KIOSK_ASSEMBLY_HOME_PATH} className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 items-center')}>
              組立トップ
            </Link>
          </div>
          <div className="mt-4 grid max-w-md grid-cols-[1fr_auto] gap-2">
            <Input
              value={pin}
              type="password"
              inputMode="numeric"
              autoFocus
              placeholder="パスワード"
              className="min-h-12 text-lg"
              disabled={busy}
              onChange={(event) => setPin(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void verifyPin();
              }}
            />
            <Button type="button" variant="primary" className="min-h-12" disabled={!pin || busy} onClick={() => void verifyPin()}>
              認証
            </Button>
          </div>
          {message ? <p className="mt-3 rounded border border-amber-400/30 bg-amber-500/15 px-3 py-2 text-sm text-amber-100">{message}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/15 bg-slate-900/70 p-2">
        <div className="min-w-0">
          <h1 className="text-[1.28rem] font-bold leading-tight">組立 閲覧順設定</h1>
          <p className="mt-1 text-sm text-white/60">既存PDF要領書を機種名ごとの閲覧順に並べます。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={KIOSK_ASSEMBLY_LIBRARY_PATH} className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 items-center')}>
            手順書/テンプレート
          </Link>
          <Link to={KIOSK_ASSEMBLY_HOME_PATH} className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 items-center')}>
            組立トップ
          </Link>
          <Button type="button" variant="primary" className="min-h-10" disabled={!canSave} onClick={() => void saveOrder()}>
            保存
          </Button>
        </div>
      </div>

      {message ? <p className="rounded border border-amber-400/30 bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-100">{message}</p> : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto xl:grid-cols-[minmax(24rem,0.85fr)_minmax(0,1.15fr)] xl:overflow-hidden">
        <section className="min-h-0 overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-3">
          <h2 className="text-[1.05rem] font-bold">対象機種</h2>
          <label className="mt-3 grid gap-1 text-sm font-semibold text-white/70">
            機種名
            <Input
              value={machineName}
              disabled={busy}
              className="min-h-12 text-lg font-bold"
              onChange={(event) => setMachineName(normalizeMachineName(event.target.value))}
            />
          </label>
          <p className="mt-2 text-xs font-semibold text-white/50">保存キー: {normalizedMachineName || '-'}</p>

          <h2 className="mt-5 text-[1.05rem] font-bold">登録済み順</h2>
          {draftItems.length === 0 ? (
            <p className="mt-2 rounded border border-white/10 bg-slate-950/45 px-3 py-4 text-sm font-semibold text-white/55">
              未設定です。右の要領書を追加してください。
            </p>
          ) : (
            <div className="mt-2 grid gap-2">
              {draftItems.map((item, index) => (
                <div key={`${item.kioskDocumentId}-${index}`} className="grid gap-2 rounded border border-white/10 bg-slate-950/55 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">{index + 1}. {documentTitle(item.document)}</p>
                      <p className="truncate text-xs text-white/50">{item.document.filename}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" variant="ghostOnDark" className="min-h-8 !px-2 !py-1 text-xs" disabled={busy || index === 0} onClick={() => moveItem(index, -1)}>
                        上
                      </Button>
                      <Button type="button" variant="ghostOnDark" className="min-h-8 !px-2 !py-1 text-xs" disabled={busy || index === draftItems.length - 1} onClick={() => moveItem(index, 1)}>
                        下
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        className="min-h-8 !px-2 !py-1 text-xs"
                        disabled={busy}
                        onClick={() => setDraftItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        削除
                      </Button>
                    </div>
                  </div>
                  <label className="grid gap-1 text-xs font-semibold text-white/60">
                    表示ラベル
                    <Input
                      value={item.label}
                      disabled={busy}
                      placeholder="例: X軸"
                      onChange={(event) =>
                        setDraftItems((current) =>
                          current.map((candidate, itemIndex) =>
                            itemIndex === index ? { ...candidate, label: event.target.value.slice(0, 120) } : candidate
                          )
                        )
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="min-h-0 overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-[1.05rem] font-bold">PDF要領書</h2>
            <span className="text-sm font-semibold text-white/55">{documents.length}件</span>
          </div>
          <label className="mt-3 grid gap-1 text-sm font-semibold text-white/70">
            検索
            <Input
              value={documentSearch}
              disabled={busy}
              placeholder="文書番号・タイトル"
              className="min-h-11"
              onChange={(event) => setDocumentSearch(event.target.value)}
            />
          </label>
          <div className="mt-3 grid gap-2">
            {documents.length === 0 ? (
              <p className="rounded border border-white/10 bg-slate-950/45 px-3 py-4 text-sm font-semibold text-white/55">
                条件に合う要領書がありません。
              </p>
            ) : (
              documents.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  className="grid gap-1 rounded border border-white/10 bg-slate-950/55 px-3 py-2 text-left hover:bg-slate-800 disabled:opacity-50"
                  disabled={busy || draftItems.length >= 50}
                  onClick={() => addDocument(document)}
                >
                  <span className="text-sm font-bold text-white">{documentTitle(document)}</span>
                  <span className="text-xs font-semibold text-white/55">
                    {document.filename} / {document.pageCount ?? '-'}ページ
                  </span>
                  {document.confirmedSummaryText ? (
                    <span className="line-clamp-2 text-xs text-white/50">{document.confirmedSummaryText}</span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
