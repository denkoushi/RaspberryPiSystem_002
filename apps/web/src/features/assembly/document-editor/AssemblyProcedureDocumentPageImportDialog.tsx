import { Fragment, useEffect, useRef, useState } from 'react';

import { getAssemblyProcedureDocument, listAssemblyProcedureDocumentSummaries } from '../../../api/client';
import { Dialog } from '../../../components/ui/Dialog';
import { KioskDigitTenkey, ASCENDING_DIGIT_KEYS } from '../../kiosk/KioskDigitTenkey';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';
import { procedureManualButtonBase, procedureManualButtonUnselected } from '../procedure-manuals/procedure-manual-button-styles';

import { AssemblyProcedureDocumentEditorPagePreview } from './AssemblyProcedureDocumentEditorPageList';
import { AssemblyProcedureDocumentPageZoomViewer } from './AssemblyProcedureDocumentPageZoomViewer';

import type {
  AssemblyProcedureDocumentDto,
  AssemblyProcedureDocumentPageDto,
  AssemblyProcedureDocumentSummaryDto,
  ProcedureManualEditorContext
} from '../types';

const importTitle = 'ほかの要領書から入れる';
const columnClassName = 'min-h-0 min-w-0 overflow-auto bg-[#161c22] p-3';
const digits = ASCENDING_DIGIT_KEYS;
const keyClassName = `${procedureManualButtonBase} ${procedureManualButtonUnselected} !min-h-0 bg-[#1b222a] text-2xl font-bold leading-none disabled:opacity-35`;
const graphemes = new Intl.Segmenter();

const normalizeSearch = (value: string) => value.normalize('NFKC').toLocaleLowerCase();

export function AssemblyProcedureDocumentPageImportDialog({
  document, pages, selectedPageIndex, context, disabled, busy, error, onClose, onImport
}: {
  document: AssemblyProcedureDocumentDto;
  pages: AssemblyProcedureDocumentPageDto[];
  selectedPageIndex: number;
  context?: ProcedureManualEditorContext;
  disabled: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onImport: (sourceDocumentId: string, sourcePageIndexes: number[], afterPageIndex: number) => Promise<void>;
}) {
  const [modelFilter, setModelFilter] = useState(context?.modelCodeKey ?? '');
  const [processFilter, setProcessFilter] = useState(context?.processId ?? '');
  const [nameFilter, setNameFilter] = useState('');
  const [sources, setSources] = useState<AssemblyProcedureDocumentSummaryDto[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [source, setSource] = useState<AssemblyProcedureDocumentDto | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [afterPageIndex, setAfterPageIndex] = useState(selectedPageIndex);
  const [zoom, setZoom] = useState<{ kind: 'source' | 'destination'; index: number } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const initialPositionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    initialPositionRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadSources = async () => {
      const limit = 200;
      const documents = new Map<string, AssemblyProcedureDocumentSummaryDto>();
      for (let offset = 0; !cancelled; offset += limit) {
        const rows = await listAssemblyProcedureDocumentSummaries({ limit, pageImportOffset: offset });
        for (const row of rows) if (row.id !== document.id) documents.set(row.id, row);
        if (rows.length < limit) break;
      }
      if (!cancelled) setSources([...documents.values()]);
    };
    void loadSources().catch(error => {
      if (!cancelled) setListError(readAssemblyApiErrorMessage(error, '要領書の一覧を取得できませんでした。'));
    });
    return () => { cancelled = true; };
  }, [document.id]);

  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    void getAssemblyProcedureDocument(sourceId).then(next => {
      if (!cancelled) setSource(next);
    }).catch(error => {
      if (!cancelled) setSourceError(readAssemblyApiErrorMessage(error, 'コピー元の要領書を取得できませんでした。'));
    });
    return () => { cancelled = true; };
  }, [sourceId]);

  const query = normalizeSearch(nameFilter).trim();
  const filteredSources = sources.flatMap(row => {
    const usage = row.manualAssignments.find(assignment =>
      (!modelFilter || assignment.modelCodeKey === modelFilter) && (!processFilter || assignment.processId === processFilter));
    if ((modelFilter || processFilter) && !usage) return [];
    const matchingUsage = query && row.manualAssignments.find(assignment => normalizeSearch(assignment.modelCode).includes(query));
    if (!matchingUsage && !normalizeSearch(row.name).includes(query)) return [];
    return [{ row, usage: matchingUsage || usage }];
  });
  const sourcePages = source?.pages ?? [];
  const zoomPages = zoom?.kind === 'source' ? sourcePages : pages;
  const zoomPage = zoom ? zoomPages[zoom.index] : undefined;
  const selectedPages = selectedIndexes.flatMap(index => sourcePages.find(page => page.pageIndex === index) ?? []);
  const allSelected = sourcePages.length > 0 && selectedIndexes.length === sourcePages.length;

  const togglePage = (pageIndex: number) => setSelectedIndexes(current =>
    current.includes(pageIndex) ? current.filter(index => index !== pageIndex) : [...current, pageIndex]);

  const selectSource = (id: string) => {
    if (id === sourceId) return;
    setSourceId(id);
    setSource(null);
    setSourceError(null);
    setSelectedIndexes([]);
  };
  const position = (index: number) => {
    const selected = index === afterPageIndex;
    const pageLabel = index === -1 ? '先頭に入れる' : `${index + 1}ページ目の後ろに入れる`;
    return (
      <button
        ref={index === selectedPageIndex ? initialPositionRef : undefined}
        type="button"
        aria-label={pageLabel}
        title={pageLabel}
        aria-pressed={selected}
        onClick={() => setAfterPageIndex(index)}
        className={`group block min-h-6 w-full rounded-md border border-dashed px-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5fc3e8] ${selected ? 'border-[#5fc3e8] bg-[#27313b] py-1.5' : 'border-transparent hover:border-[#5fc3e8]'}`}
      >
        {selected && selectedPages.length ? (
          <div className="flex flex-wrap justify-center gap-1.5">
            {selectedPages.map(page => <div key={page.pageIndex} className="w-9"><AssemblyProcedureDocumentEditorPagePreview page={page} assets={source?.assets} lazy /></div>)}
          </div>
        ) : <span className={`mx-auto block w-full border-t border-dashed ${selected ? 'border-[#5fc3e8]' : 'border-[#344252] group-hover:border-[#5fc3e8]'}`} />}
      </button>
    );
  };

  return (
    <Dialog isOpen title={importTitle} size="full" onClose={onClose} closeOnEsc={!busy && !zoomPage} closeOnBackdrop={!busy && !zoomPage}
      trapFocus={!zoomPage}
      initialFocusRef={searchRef} overlayClassName="!items-center"
      className="flex !max-w-[1160px] flex-col !rounded-[14px] !border !border-[#344252] !bg-[#0a0d10] !text-[#eef3f6]"
      titleClassName="!text-2xl !font-black"
    >
      <fieldset disabled={busy} inert={Boolean(zoomPage)} className="my-4 grid h-[min(65dvh,640px)] min-h-0 grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,0.65fr)] gap-px overflow-hidden rounded-lg border border-[#27313b] bg-[#27313b]">
        <section aria-label="コピー元の要領書一覧" className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#161c22] p-3">
          <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5 font-bold">
            <FilterChip value={modelFilter && (context?.modelCode || modelFilter)} fallback="全機種" removeLabel="機種の絞り込みを外す" onRemove={() => setModelFilter('')} />
            <span aria-hidden="true" className="text-[#9fadb9]">›</span>
            <FilterChip value={processFilter && context?.processName.split(' › ').at(-1)?.replace(/工程/g, '')} fallback="全工程" removeLabel="工程の絞り込みを外す" onRemove={() => setProcessFilter('')} />
          </div>
          <input ref={searchRef} type="search" aria-label="名前で絞り込み" placeholder="名前で絞り込み" value={nameFilter}
            onChange={event => setNameFilter(event.target.value)} className="mb-3 h-11 w-full shrink-0 rounded-lg border border-[#344252] bg-white px-3 text-[#0f1317] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5fc3e8]" />
          {listError ? <p role="alert" className="text-red-400">{listError}</p> : null}
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_52px] gap-2">
            <div className="min-h-0 space-y-1.5 overflow-auto">
              {filteredSources.map(({ row, usage }) => {
                const model = usage?.modelCode;
                const process = usage?.processName.replace(/工程/g, '');
                return (
                  <button key={row.id} type="button" aria-pressed={row.id === sourceId} onClick={() => selectSource(row.id)}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 rounded-lg border px-2.5 py-2 text-left ${row.id === sourceId ? 'border-[#5fc3e8] bg-[#27313b]' : 'border-[#344252]'}`}>
                    <span className="break-words font-bold">{highlightMatch(row.name, query)}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-xs ${row.status === 'published' ? 'border-[#3ba776] text-[#8ad4b3]' : 'border-[#344252] text-[#9fadb9]'}`}>
                      {row.status === 'published' ? '公開' : '下書き'}
                    </span>
                    <span className="col-span-2 break-words text-sm text-[#9fadb9]">
                      {model ? highlightMatch(model, query) : null}{model && process ? ' › ' : ''}{process}
                      {model || process ? ' · ' : ''}{row.pages.length}ページ
                    </span>
                  </button>
                );
              })}
            </div>
            <KioskDigitTenkey value={nameFilter} onChange={setNameFilter} digits={digits}
              showBackspace showReset={false} ariaLabel="数字テンキー"
              className="grid h-full max-h-[522px] min-h-0 grid-cols-1 grid-rows-[repeat(11,minmax(0,1fr))] gap-1"
              keyClassName={`${keyClassName} text-[#eef3f6]`} resetClassName={`${keyClassName} text-[#9fadb9]`} />
          </div>
        </section>
        <section aria-label="コピー元のページ" className={columnClassName}>
          {sourceId ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="min-w-0 break-words text-lg font-bold">{source?.name ?? sources.find(row => row.id === sourceId)?.name}</h3>
            <button type="button" disabled={!sourcePages.length} className="min-h-10 rounded-lg border border-[#344252] px-2.5 disabled:opacity-40"
              onClick={() => setSelectedIndexes(current => allSelected ? [] : [...current, ...sourcePages.map(page => page.pageIndex).filter(index => !current.includes(index))])}>
              {allSelected ? '選択を外す' : 'すべて選ぶ'}
            </button>
          </div> : null}
          {sourceError ? <p role="alert" className="text-red-400">{sourceError}</p> : null}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100px,100%),1fr))] gap-2.5">
            {sourcePages.map((page, index) => {
              const order = selectedIndexes.indexOf(page.pageIndex) + 1;
              return (
                <div key={page.pageIndex} className="relative">
                  <button type="button" aria-label={`${page.pageIndex + 1}ページ目`} aria-pressed={order > 0}
                    onClick={() => togglePage(page.pageIndex)}
                    className={`relative block w-full rounded-md border-2 p-0.5 ${order > 0 ? 'border-[#5fc3e8]' : 'border-[#344252]'}`}>
                    <AssemblyProcedureDocumentEditorPagePreview page={page} assets={source?.assets} lazy />
                    {order > 0 ? <span className="absolute right-1.5 top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-[#5fc3e8] px-1 font-mono text-sm font-bold text-[#0a0d10]">{order}</span> : null}
                  </button>
                  <button type="button" aria-label={`${page.pageIndex + 1}ページ目を拡大`}
                    onClick={() => setZoom({ kind: 'source', index })}
                    className="absolute bottom-1.5 right-1.5 grid h-10 w-10 place-items-center rounded-lg border border-[#344252] bg-[#0f1317e6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5fc3e8]">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="10.5" cy="10.5" r="6.5" />
                      <path d="m15.5 15.5 4.5 4.5M7.5 10.5h6m-3-3v6" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
        <section aria-label="差し込み先のページ" className={columnClassName}>
          {position(-1)}
          {pages.map((page, index) => <Fragment key={page.pageIndex}>
            <button type="button" className="mx-auto block w-14 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5fc3e8]"
              aria-label={`${page.pageIndex + 1}ページ目を拡大`} onClick={() => setZoom({ kind: 'destination', index })}>
              <AssemblyProcedureDocumentEditorPagePreview page={page} assets={document.assets} lazy />
            </button>
            {position(page.pageIndex)}
          </Fragment>)}
        </section>
      </fieldset>
      <div inert={Boolean(zoomPage)} className="flex flex-wrap items-center justify-end gap-3">
        {error ? <p role="alert" className="mr-auto text-red-400">{error}</p> : null}
        <button type="button" disabled={busy} className="rounded-lg border border-[#344252] px-5 py-3 font-semibold disabled:opacity-40" onClick={onClose}>やめる</button>
        <button type="button" disabled={disabled || busy || !selectedIndexes.length}
          className="rounded-lg bg-[#3ba776] px-5 py-3 font-bold text-[#0a0d10] disabled:opacity-40"
          onClick={() => void onImport(sourceId, selectedIndexes, afterPageIndex)}>{selectedIndexes.length}ページを入れる</button>
      </div>
      {zoom && zoomPage ? (
        <AssemblyProcedureDocumentPageZoomViewer page={zoomPage} assets={zoom.kind === 'source' ? source?.assets : document.assets}
          index={zoom.index} total={zoomPages.length}
          selection={zoom.kind === 'source' ? {
            order: selectedIndexes.indexOf(zoomPage.pageIndex) + 1,
            onToggle: () => togglePage(zoomPage.pageIndex)
          } : undefined}
          onNavigate={index => setZoom({ kind: zoom.kind, index })} onClose={() => setZoom(null)} />
      ) : null}
    </Dialog>
  );
}

function highlightMatch(value: string, query: string) {
  if (!query) return value;
  const match = normalizeSearch(value).indexOf(query);
  if (match === -1) return value;

  // Map the normalized match back to the displayed text, including composed characters.
  let start = 0;
  let end = 0;
  let normalizedEnd = 0;
  for (const { segment, index } of graphemes.segment(value)) {
    normalizedEnd += normalizeSearch(segment).length;
    if (normalizedEnd <= match) continue;
    if (end === 0) start = index;
    end = index + segment.length;
    if (normalizedEnd >= match + query.length) break;
  }
  return <>{value.slice(0, start)}<mark className="rounded-[3px] bg-[#f6b93b66] text-inherit">{value.slice(start, end)}</mark>{value.slice(end)}</>;
}

function FilterChip({ value, fallback, removeLabel, onRemove }: {
  value?: string;
  fallback: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  return <span className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[#344252] pl-3 ${value ? '' : 'border-dashed pr-3 text-[#9fadb9]'}`}>
    {value || fallback}
    {value ? <button type="button" title={removeLabel} aria-label={removeLabel} onClick={onRemove} className="h-10 w-10 text-xl text-[#9fadb9]">×</button> : null}
  </span>;
}
