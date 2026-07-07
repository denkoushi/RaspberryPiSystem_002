import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import {
  getAssemblyProcedureOrder,
  getKioskDocumentDetail,
  listAssemblyProcedureDocumentSummaries,
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
import { KioskDocumentPageImage } from '../../features/assembly/KioskDocumentPageImage';

import type { AssemblyProcedureDocumentSummaryDto, AssemblyProcedureOrderDocumentDto, AssemblyProcedureOrderDto } from '../../features/assembly/types';

type DraftItem = {
  documentType: 'kiosk_document' | 'assembly_procedure_document';
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  label: string;
  document: AssemblyProcedureOrderDocumentDto;
};

type PreviewTarget =
  | { source: 'draft'; index: number }
  | { source: 'library'; document: AssemblyProcedureDocumentSummaryDto };

function toHalfWidthAscii(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

function normalizeMachineName(value: string): string {
  return toHalfWidthAscii(value).trim().toUpperCase().slice(0, 120);
}

function documentTitle(document: Pick<AssemblyProcedureOrderDocumentDto, 'documentType' | 'displayTitle' | 'title' | 'confirmedDocumentNumber'>): string {
  if (document.documentType === 'assembly_procedure_document') {
    return document.title;
  }
  const number = document.confirmedDocumentNumber?.trim();
  const title = document.displayTitle?.trim() || document.title;
  return number ? `${number} ${title}` : title;
}

function documentTypeLabel(documentType: DraftItem['documentType']): string {
  return documentType === 'assembly_procedure_document' ? '組立手順書' : 'PDF要領書';
}

function draftItemKey(item: DraftItem, index: number): string {
  return `${item.documentType}:${item.kioskDocumentId ?? item.assemblyProcedureDocumentId ?? index}`;
}

function orderToDraft(order: AssemblyProcedureOrderDto): DraftItem[] {
  return order.items.map((item) => ({
    documentType: item.documentType,
    kioskDocumentId: item.kioskDocumentId,
    assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
    label: item.label ?? '',
    document: item.document
  }));
}

function draftToSaveItem(item: DraftItem) {
  return {
    kioskDocumentId: item.kioskDocumentId,
    assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
    label: item.label.trim() || null
  };
}

function ProcedureOrderPreviewPane({ target, draftItems }: { target: PreviewTarget | null; draftItems: DraftItem[] }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageUrls, setPageUrls] = useState<string[]>([]);
  const [previewTitle, setPreviewTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewDocument = useMemo(() => {
    if (!target) return null;
    if (target.source === 'draft') return draftItems[target.index] ?? null;
    return {
      documentType: 'assembly_procedure_document' as const,
      kioskDocumentId: null,
      assemblyProcedureDocumentId: target.document.id,
      label: '',
      document: {
        id: target.document.id,
        documentType: 'assembly_procedure_document' as const,
        title: target.document.name,
        displayTitle: null,
        filename: target.document.name,
        confirmedDocumentNumber: null,
        confirmedSummaryText: null,
        pageCount: 1,
        enabled: target.document.isActive,
        updatedAt: target.document.updatedAt,
        imageRelativePath: target.document.imageRelativePath
      }
    };
  }, [draftItems, target]);

  useEffect(() => {
    setPageIndex(0);
  }, [target, previewDocument?.document.id]);

  useEffect(() => {
    if (!previewDocument) {
      setPageUrls([]);
      setPreviewTitle('');
      setError(null);
      setLoading(false);
      return;
    }

    setPreviewTitle(documentTitle(previewDocument.document));

    if (previewDocument.documentType === 'assembly_procedure_document') {
      const imageRelativePath = previewDocument.document.imageRelativePath;
      setPageUrls(imageRelativePath ? [imageRelativePath] : []);
      setError(imageRelativePath ? null : 'プレビュー画像がありません');
      setLoading(false);
      return;
    }

    const kioskDocumentId = previewDocument.kioskDocumentId;
    if (!kioskDocumentId) {
      setPageUrls([]);
      setError('プレビュー対象の要領書IDがありません');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void getKioskDocumentDetail(kioskDocumentId)
      .then((detail) => {
        if (cancelled) return;
        setPageUrls(detail.pageUrls ?? []);
        if ((detail.pageUrls ?? []).length === 0) {
          setError('表示できるページがありません');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setPageUrls([]);
        setError('要領書プレビューの取得に失敗しました');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [previewDocument]);

  if (!target || !previewDocument) {
    return (
      <div className="flex h-full min-h-[18rem] items-center justify-center rounded border border-dashed border-white/15 bg-slate-950/45 p-4 text-sm font-semibold text-white/55">
        一覧または登録済み順から項目を選択するとプレビューが表示されます
      </div>
    );
  }

  const currentPageUrl = pageUrls[pageIndex] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded border border-white/15 bg-slate-950/55">
      <div className="shrink-0 border-b border-white/10 p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">{previewTitle}</p>
            <p className="truncate text-xs font-semibold text-white/55">
              {documentTypeLabel(previewDocument.documentType)}
              {pageUrls.length > 0 ? ` / ${pageIndex + 1}/${pageUrls.length}ページ` : ''}
            </p>
          </div>
          {previewDocument.documentType === 'kiosk_document' && pageUrls.length > 1 ? (
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                variant="ghostOnDark"
                className="min-h-8 !px-2 !py-1 text-xs"
                disabled={pageIndex === 0}
                onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
              >
                前頁
              </Button>
              <Button
                type="button"
                variant="ghostOnDark"
                className="min-h-8 !px-2 !py-1 text-xs"
                disabled={pageIndex >= pageUrls.length - 1}
                onClick={() => setPageIndex((current) => Math.min(pageUrls.length - 1, current + 1))}
              >
                次頁
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
        {loading ? (
          <p className="text-sm font-semibold text-white/55">プレビューを読み込み中...</p>
        ) : error ? (
          <p className="text-sm font-semibold text-amber-100">{error}</p>
        ) : currentPageUrl ? (
          <KioskDocumentPageImage
            pageUrl={currentPageUrl}
            alt=""
            className="h-full max-h-full w-full max-w-full object-contain"
            loadingFallback={<p className="text-sm font-semibold text-white/55">プレビューを読み込み中...</p>}
            errorFallback={<p className="text-sm font-semibold text-amber-100">画像の読み込みに失敗しました</p>}
          />
        ) : (
          <p className="text-sm font-semibold text-white/55">表示できるプレビューがありません</p>
        )}
      </div>
    </div>
  );
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
  const [procedureDocuments, setProcedureDocuments] = useState<AssemblyProcedureDocumentSummaryDto[]>([]);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const accessGranted = accessPassword != null;
  const normalizedMachineName = useMemo(() => normalizeMachineName(machineName), [machineName]);
  const canSave = accessGranted && normalizedMachineName.length > 0 && !busy;
  const filteredProcedureDocuments = useMemo(() => {
    const query = documentSearch.trim().toLowerCase();
    if (!query) return procedureDocuments;
    return procedureDocuments.filter((document) => document.name.toLowerCase().includes(query));
  }, [documentSearch, procedureDocuments]);

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
        setPreviewTarget(null);
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
    void listAssemblyProcedureDocumentSummaries({ limit: 200 })
      .then(setProcedureDocuments)
      .catch((error: unknown) => setMessage(readAssemblyApiErrorMessage(error, '組立手順書一覧の取得に失敗しました。')));
  }, [accessGranted]);

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

  const addProcedureDocument = (document: AssemblyProcedureDocumentSummaryDto) => {
    setDraftItems((current) => [
      ...current,
      {
        documentType: 'assembly_procedure_document',
        kioskDocumentId: null,
        assemblyProcedureDocumentId: document.id,
        label: '',
        document: {
          id: document.id,
          documentType: 'assembly_procedure_document',
          title: document.name,
          displayTitle: null,
          filename: document.name,
          confirmedDocumentNumber: null,
          confirmedSummaryText: null,
          pageCount: 1,
          enabled: document.isActive,
          updatedAt: document.updatedAt,
          imageRelativePath: document.imageRelativePath
        }
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
        items: draftItems.map((item) => draftToSaveItem(item))
      });
      setDraftItems(orderToDraft(saved));
      setLoadedMachineName(saved.machineName);
      setMachineName(saved.machineName);
      setPreviewTarget(null);
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
          <p className="mt-1 text-sm text-white/60">組立手順書と既存PDF要領書を機種名ごとの閲覧順に並べます。</p>
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

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto xl:grid-cols-[20rem_20rem_minmax(0,1fr)] xl:overflow-hidden">
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
              未設定です。右の組立手順書を追加してください。
            </p>
          ) : (
            <div className="mt-2 grid gap-2">
              {draftItems.map((item, index) => {
                const selected = previewTarget?.source === 'draft' && previewTarget.index === index;
                return (
                  <div
                    key={draftItemKey(item, index)}
                    className={`grid gap-2 rounded border p-2 ${
                      selected ? 'border-cyan-300/70 bg-cyan-950/25' : 'border-white/10 bg-slate-950/55'
                    }`}
                  >
                    <button
                      type="button"
                      className="grid gap-1 text-left"
                      disabled={busy}
                      onClick={() => setPreviewTarget({ source: 'draft', index })}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-white">
                            {index + 1}. {documentTitle(item.document)}
                          </p>
                          <p className="truncate text-xs text-white/50">{item.document.filename}</p>
                        </div>
                        <span className="shrink-0 rounded border border-white/15 bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-bold text-white/70">
                          {documentTypeLabel(item.documentType)}
                        </span>
                      </div>
                    </button>
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
                        onClick={() => {
                          setDraftItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
                          setPreviewTarget((current) =>
                            current?.source === 'draft' && current.index === index
                              ? null
                              : current?.source === 'draft' && current.index > index
                                ? { source: 'draft', index: current.index - 1 }
                                : current
                          );
                        }}
                      >
                        削除
                      </Button>
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
                );
              })}
            </div>
          )}
        </section>

        <section className="min-h-0 overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-[1.05rem] font-bold">組立手順書</h2>
            <span className="text-sm font-semibold text-white/55">{filteredProcedureDocuments.length}件</span>
          </div>
          <label className="mt-3 grid gap-1 text-sm font-semibold text-white/70">
            検索
            <Input
              value={documentSearch}
              disabled={busy}
              placeholder="手順書名"
              className="min-h-11"
              onChange={(event) => setDocumentSearch(event.target.value)}
            />
          </label>
          <div className="mt-3 grid gap-2">
            {filteredProcedureDocuments.length === 0 ? (
              <p className="rounded border border-white/10 bg-slate-950/45 px-3 py-4 text-sm font-semibold text-white/55">
                条件に合う組立手順書がありません。
              </p>
            ) : (
              filteredProcedureDocuments.map((document) => {
                const selected = previewTarget?.source === 'library' && previewTarget.document.id === document.id;
                return (
                  <div
                    key={document.id}
                    className={`grid gap-2 rounded border px-2 py-2 ${
                      selected ? 'border-cyan-300/70 bg-cyan-950/25' : 'border-white/10 bg-slate-950/55'
                    }`}
                  >
                    <button
                      type="button"
                      className="grid gap-1 text-left"
                      disabled={busy}
                      onClick={() => setPreviewTarget({ source: 'library', document })}
                    >
                      <span className="text-sm font-bold text-white">{document.name}</span>
                      <span className="text-xs font-semibold text-white/55">組立手順書 / 1ページ</span>
                    </button>
                    <Button
                      type="button"
                      variant="ghostOnDark"
                      className="min-h-8 justify-self-start !px-2 !py-1 text-xs"
                      disabled={busy || draftItems.length >= 50}
                      onClick={() => addProcedureDocument(document)}
                    >
                      追加
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="flex min-h-[18rem] min-w-0 flex-col overflow-hidden rounded border border-white/15 bg-slate-900/70 p-3 xl:min-h-0">
          <h2 className="mb-2 shrink-0 text-[1.05rem] font-bold">プレビュー</h2>
          <ProcedureOrderPreviewPane target={previewTarget} draftItems={draftItems} />
        </section>
      </main>
    </div>
  );
}
