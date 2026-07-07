import { useEffect, useMemo, useState } from 'react';

import { resolveKioskDocumentPageImageUrl } from '../../api/client';
import { Button } from '../../components/ui/Button';

import { isAssemblyProcedureImagePath, KioskDocumentPageImage } from './KioskDocumentPageImage';

import type { AssemblyProcedureSequenceDto } from './types';

type Props = {
  sequence: AssemblyProcedureSequenceDto;
  className?: string;
};

function displayTitle(document: AssemblyProcedureSequenceDto['documents'][number]): string {
  const title = document.displayTitle?.trim() || document.title;
  return document.confirmedDocumentNumber ? `${document.confirmedDocumentNumber} ${title}` : title;
}

function clampIndex(value: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, value));
}

export function AssemblyProcedureSequenceViewer({ sequence, className }: Props) {
  const [documentIndex, setDocumentIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const documents = sequence.documents;
  const document = documents[clampIndex(documentIndex, documents.length)] ?? null;
  const pageUrls = useMemo(() => document?.pageUrls ?? [], [document?.pageUrls]);
  const pageUrl = pageUrls[clampIndex(pageIndex, pageUrls.length)] ?? null;

  const totalPages = useMemo(
    () => documents.reduce((sum, item) => sum + item.pageUrls.length, 0),
    [documents]
  );

  useEffect(() => {
    setDocumentIndex(0);
    setPageIndex(0);
  }, [sequence.machineNameKey]);

  useEffect(() => {
    setDocumentIndex((current) => clampIndex(current, documents.length));
  }, [documents.length]);

  useEffect(() => {
    setPageIndex((current) => clampIndex(current, pageUrls.length));
  }, [pageUrls.length]);

  useEffect(() => {
    const prefetchTargets = [
      pageUrls[pageIndex + 1],
      pageUrls[pageIndex + 2],
      documents[documentIndex + 1]?.pageUrls[0],
    ].filter((url): url is string => Boolean(url));
    for (const url of prefetchTargets) {
      if (isAssemblyProcedureImagePath(url)) continue;
      const img = new Image();
      img.src = resolveKioskDocumentPageImageUrl(url);
    }
  }, [documentIndex, documents, pageIndex, pageUrls]);

  const goPrevPage = () => {
    if (!document) return;
    if (pageIndex > 0) setPageIndex((current) => current - 1);
  };

  const goNextPage = () => {
    if (!document) return;
    if (pageIndex < pageUrls.length - 1) setPageIndex((current) => current + 1);
  };

  const goPrevDocument = () => {
    if (!document) return;
    if (documentIndex > 0) {
      setDocumentIndex((current) => current - 1);
      setPageIndex(0);
    }
  };

  const goNextDocument = () => {
    if (!document) return;
    if (documentIndex < documents.length - 1) {
      setDocumentIndex((current) => current + 1);
      setPageIndex(0);
    }
  };

  if (!document || !pageUrl) {
    return (
      <div className={className}>
        <div className="flex h-full min-h-[18rem] items-center justify-center bg-slate-950 text-sm font-semibold text-white/60">
          表示できる要領書ページがありません
        </div>
      </div>
    );
  }

  return (
    <div className={`flex min-h-0 flex-col bg-slate-950 ${className ?? ''}`}>
      <div className="shrink-0 border-b border-white/10 bg-slate-900/80 p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">{document.label?.trim() || displayTitle(document)}</p>
            <p className="truncate text-xs font-semibold text-white/55">{displayTitle(document)} / {pageIndex + 1}/{pageUrls.length}ページ / 全{totalPages}ページ</p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            <Button type="button" variant="ghostOnDark" className="min-h-9 !px-2 !py-1 text-sm" disabled={documentIndex === 0} onClick={goPrevDocument}>前書</Button>
            <Button type="button" variant="ghostOnDark" className="min-h-9 !px-2 !py-1 text-sm" disabled={pageIndex === 0} onClick={goPrevPage}>前頁</Button>
            <Button type="button" variant="ghostOnDark" className="min-h-9 !px-2 !py-1 text-sm" disabled={pageIndex === pageUrls.length - 1} onClick={goNextPage}>次頁</Button>
            <Button type="button" variant="ghostOnDark" className="min-h-9 !px-2 !py-1 text-sm" disabled={documentIndex === documents.length - 1} onClick={goNextDocument}>次書</Button>
          </div>
        </div>
        <div className="mt-2 flex gap-1 overflow-x-auto">
          {documents.map((item, index) => (
            <button key={item.orderItemId} type="button" className={`shrink-0 rounded border px-2 py-1 text-xs font-semibold ${index === documentIndex ? 'border-cyan-300 bg-cyan-900/45 text-cyan-100' : 'border-white/10 bg-slate-950/70 text-white/65 hover:bg-slate-800'}`} onClick={() => { setDocumentIndex(index); setPageIndex(0); }}>
              {index + 1}. {item.label?.trim() || item.displayTitle || item.title}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
        <KioskDocumentPageImage pageUrl={pageUrl} alt="" className="h-full max-h-full w-full max-w-full object-contain" />
      </div>
    </div>
  );
}
