import clsx from 'clsx';

import type { KioskDocumentSource } from '../../../api/client';

export type KioskDocumentsListPanelProps = {
  search: string;
  onSearchChange: (value: string) => void;
  sourceFilter: '' | KioskDocumentSource;
  onSourceFilterChange: (value: '' | KioskDocumentSource) => void;
  documents: Array<{
    id: string;
    title: string;
    displayTitle: string | null;
    filename: string;
    confirmedFhincd: string | null;
    confirmedDrawingNumber: string | null;
    sourceAttachmentName: string | null;
    sourceType: KioskDocumentSource;
  }>;
  selectedId: string | null;
  onSelectId: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
  className?: string;
};

export function KioskDocumentsListPanel({
  search,
  onSearchChange,
  sourceFilter,
  onSourceFilterChange,
  documents,
  selectedId,
  onSelectId,
  isLoading,
  isError,
  className,
}: KioskDocumentsListPanelProps) {
  return (
    <section
      id="kiosk-documents-list-panel"
      className={clsx(
        'flex min-h-0 w-full flex-col rounded-lg border border-white/10 bg-slate-900/50 lg:w-[min(100%,380px)] lg:shrink-0',
        className
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
          onChange={(e) => onSearchChange(e.target.value)}
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
            onClick={() => onSourceFilterChange('')}
          >
            すべて
          </button>
          <button
            type="button"
            className={clsx(
              'rounded px-2 py-1 font-semibold',
              sourceFilter === 'MANUAL' ? 'bg-teal-600 text-white' : 'bg-white/10 text-white/80 hover:bg-white/15'
            )}
            onClick={() => onSourceFilterChange('MANUAL')}
          >
            手動
          </button>
          <button
            type="button"
            className={clsx(
              'rounded px-2 py-1 font-semibold',
              sourceFilter === 'GMAIL' ? 'bg-teal-600 text-white' : 'bg-white/10 text-white/80 hover:bg-white/15'
            )}
            onClick={() => onSourceFilterChange('GMAIL')}
          >
            Gmail
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {isLoading ? (
          <p className="p-2 text-sm text-white/70">読み込み中…</p>
        ) : isError ? (
          <p className="p-2 text-sm text-red-300">一覧の取得に失敗しました</p>
        ) : documents.length === 0 ? (
          <p className="p-2 text-sm text-white/70">表示する要領書がありません</p>
        ) : (
          <ul className="space-y-1">
            {documents.map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => onSelectId(doc.id)}
                  className={clsx(
                    'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
                    selectedId === doc.id
                      ? 'border-teal-400 bg-teal-900/40 text-white'
                      : 'border-transparent bg-white/5 text-white/90 hover:bg-white/10'
                  )}
                >
                  <div className="font-semibold leading-snug">{doc.displayTitle || doc.title}</div>
                  <div className="mt-0.5 text-xs text-white/60">
                    {doc.sourceAttachmentName || doc.filename} · {doc.sourceType === 'GMAIL' ? 'Gmail' : '手動'}
                  </div>
                  {(doc.confirmedFhincd || doc.confirmedDrawingNumber) ? (
                    <div className="mt-0.5 text-[11px] text-teal-200/90">
                      {doc.confirmedFhincd ? `FHINCD: ${doc.confirmedFhincd}` : ''}
                      {doc.confirmedFhincd && doc.confirmedDrawingNumber ? ' · ' : ''}
                      {doc.confirmedDrawingNumber ? `図面: ${doc.confirmedDrawingNumber}` : ''}
                    </div>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
