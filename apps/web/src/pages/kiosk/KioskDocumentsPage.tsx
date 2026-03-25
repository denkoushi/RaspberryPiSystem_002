import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';

import { resolveKioskDocumentPageImageUrl, type KioskDocumentSource } from '../../api/client';
import { useKioskDocumentDetail, useKioskDocuments } from '../../api/hooks';
import { Button } from '../../components/ui/Button';

type LayoutMode = 'single' | 'spread';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.25;

export function KioskDocumentsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'' | KioskDocumentSource>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('single');
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const listQuery = useKioskDocuments({
    q: debouncedSearch || undefined,
    sourceType: sourceFilter || undefined,
  });

  const documents = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  useEffect(() => {
    if (documents.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !documents.some((d) => d.id === selectedId)) {
      setSelectedId(documents[0].id);
    }
  }, [documents, selectedId]);

  const detailQuery = useKioskDocumentDetail(selectedId);
  const pageUrls = useMemo(() => detailQuery.data?.pageUrls ?? [], [detailQuery.data?.pageUrls]);

  const pagePairs = useMemo(() => {
    if (layoutMode === 'single') {
      return pageUrls.map((u) => [u] as string[]);
    }
    const pairs: string[][] = [];
    for (let i = 0; i < pageUrls.length; i += 2) {
      pairs.push(pageUrls.slice(i, i + 2));
    }
    return pairs;
  }, [layoutMode, pageUrls]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-4">
      <section
        className={clsx(
          'flex min-h-0 w-full flex-col rounded-lg border border-white/10 bg-slate-900/50 lg:w-[min(100%,380px)] lg:shrink-0'
        )}
        aria-label="要領書一覧"
      >
        <div className="space-y-2 border-b border-white/10 p-3">
          <label className="sr-only" htmlFor="kiosk-doc-search">
            ファイル名・タイトルで検索
          </label>
          <input
            id="kiosk-doc-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ファイル名・タイトルで検索"
            className="w-full rounded-md border border-white/20 bg-slate-950/80 px-3 py-2 text-sm text-white placeholder:text-white/40"
          />
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="text-white/60">取込元:</span>
            <button
              type="button"
              className={clsx(
                'rounded px-2 py-1 font-semibold',
                sourceFilter === '' ? 'bg-teal-600 text-white' : 'bg-white/10 text-white/80 hover:bg-white/15'
              )}
              onClick={() => setSourceFilter('')}
            >
              すべて
            </button>
            <button
              type="button"
              className={clsx(
                'rounded px-2 py-1 font-semibold',
                sourceFilter === 'MANUAL' ? 'bg-teal-600 text-white' : 'bg-white/10 text-white/80 hover:bg-white/15'
              )}
              onClick={() => setSourceFilter('MANUAL')}
            >
              手動
            </button>
            <button
              type="button"
              className={clsx(
                'rounded px-2 py-1 font-semibold',
                sourceFilter === 'GMAIL' ? 'bg-teal-600 text-white' : 'bg-white/10 text-white/80 hover:bg-white/15'
              )}
              onClick={() => setSourceFilter('GMAIL')}
            >
              Gmail
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {listQuery.isLoading ? (
            <p className="p-2 text-sm text-white/70">読み込み中…</p>
          ) : listQuery.isError ? (
            <p className="p-2 text-sm text-red-300">一覧の取得に失敗しました</p>
          ) : documents.length === 0 ? (
            <p className="p-2 text-sm text-white/70">表示する要領書がありません</p>
          ) : (
            <ul className="space-y-1">
              {documents.map((doc) => (
                <li key={doc.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(doc.id)}
                    className={clsx(
                      'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      selectedId === doc.id
                        ? 'border-teal-400 bg-teal-900/40 text-white'
                        : 'border-transparent bg-white/5 text-white/90 hover:bg-white/10'
                    )}
                  >
                    <div className="font-semibold leading-snug">{doc.title}</div>
                    <div className="mt-0.5 text-xs text-white/60">
                      {doc.sourceAttachmentName || doc.filename} · {doc.sourceType === 'GMAIL' ? 'Gmail' : '手動'}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-white/10 bg-slate-900/40"
        aria-label="要領書ビューア"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
          <div className="flex gap-1 rounded-md bg-slate-950/60 p-1">
            <button
              type="button"
              className={clsx(
                'rounded px-3 py-1.5 text-xs font-semibold',
                layoutMode === 'single' ? 'bg-teal-600 text-white' : 'text-white/70 hover:text-white'
              )}
              onClick={() => setLayoutMode('single')}
            >
              1ページ
            </button>
            <button
              type="button"
              className={clsx(
                'rounded px-3 py-1.5 text-xs font-semibold',
                layoutMode === 'spread' ? 'bg-teal-600 text-white' : 'text-white/70 hover:text-white'
              )}
              onClick={() => setLayoutMode('spread')}
            >
              見開き
            </button>
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" className="px-2 py-1 text-white" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}>
              −
            </Button>
            <span className="min-w-[3.5rem] text-center text-xs text-white/80">{Math.round(zoom * 100)}%</span>
            <Button type="button" variant="ghost" className="px-2 py-1 text-white" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}>
              ＋
            </Button>
            <Button type="button" variant="ghost" className="px-2 py-1 text-xs text-white/80" onClick={() => setZoom(1)}>
              リセット
            </Button>
          </div>
          {detailQuery.data?.document ? (
            <span className="ml-auto truncate text-xs text-white/60" title={detailQuery.data.document.title}>
              {detailQuery.data.document.title}
            </span>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {!selectedId ? (
            <p className="text-sm text-white/60">左の一覧から文書を選択してください</p>
          ) : detailQuery.isLoading ? (
            <p className="text-sm text-white/60">表示準備中…</p>
          ) : detailQuery.isError ? (
            <p className="text-sm text-red-300">文書の読み込みに失敗しました</p>
          ) : pageUrls.length === 0 ? (
            <p className="text-sm text-white/60">ページ画像がありません（PDFの再変換が必要な場合があります）</p>
          ) : (
            <div
              className="inline-block min-w-full"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
              }}
            >
              <div className="space-y-4">
                {pagePairs.map((pair, rowIdx) => (
                  <div
                    key={`row-${rowIdx}`}
                    className={clsx(
                      'flex flex-wrap justify-center gap-4',
                      layoutMode === 'spread' && pair.length === 1 ? 'justify-center' : ''
                    )}
                  >
                    {pair.map((url) => (
                      <div
                        key={url}
                        className={clsx(
                          'flex justify-center',
                          layoutMode === 'spread' ? 'w-[min(100%,48%)] min-w-[280px]' : 'w-full max-w-4xl'
                        )}
                      >
                        <img
                          src={resolveKioskDocumentPageImageUrl(url)}
                          alt=""
                          className="max-w-full rounded border border-white/10 shadow-lg"
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
