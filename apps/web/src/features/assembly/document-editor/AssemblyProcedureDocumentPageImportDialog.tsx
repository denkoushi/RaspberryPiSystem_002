import { Fragment, useEffect, useRef, useState } from 'react';

import { getAssemblyProcedureDocument, listAssemblyProcedureDocumentSummaries } from '../../../api/client';
import { Dialog } from '../../../components/ui/Dialog';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { AssemblyProcedureDocumentEditorPagePreview } from './AssemblyProcedureDocumentEditorPageList';

import type {
  AssemblyProcedureDocumentDto,
  AssemblyProcedureDocumentPageDto,
  AssemblyProcedureDocumentSummaryDto,
  ProcedureManualEditorContext
} from '../types';

const importTitle = 'ほかの要領書から入れる';
const columnClassName = 'min-h-0 min-w-0 overflow-auto bg-[#161c22] p-3';

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

  const query = nameFilter.normalize('NFKC').trim().toLocaleLowerCase();
  const filteredSources = sources.flatMap(row => {
    const usage = row.manualAssignments.find(assignment =>
      (!modelFilter || assignment.modelCodeKey === modelFilter) && (!processFilter || assignment.processId === processFilter));
    if (((modelFilter || processFilter) && !usage) || !row.name.normalize('NFKC').toLocaleLowerCase().includes(query)) return [];
    return [{ row, usage }];
  });
  const sourcePages = source?.pages ?? [];
  const selectedPages = selectedIndexes.flatMap(index => sourcePages.find(page => page.pageIndex === index) ?? []);
  const allSelected = sourcePages.length > 0 && selectedIndexes.length === sourcePages.length;

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
            {selectedPages.map(page => <div key={page.pageIndex} className="w-9"><AssemblyProcedureDocumentEditorPagePreview page={page} assets={source?.assets} /></div>)}
          </div>
        ) : <span className={`mx-auto block w-full border-t border-dashed ${selected ? 'border-[#5fc3e8]' : 'border-[#344252] group-hover:border-[#5fc3e8]'}`} />}
      </button>
    );
  };

  return (
    <Dialog isOpen title={importTitle} size="full" onClose={onClose} closeOnEsc={!busy} closeOnBackdrop={!busy}
      initialFocusRef={searchRef} overlayClassName="!items-center"
      className="flex !max-w-[1160px] flex-col !rounded-[14px] !border !border-[#344252] !bg-[#0a0d10] !text-[#eef3f6]"
      titleClassName="!text-2xl !font-black"
    >
      <fieldset disabled={busy} className="my-4 grid h-[min(65dvh,640px)] min-h-0 grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,0.65fr)] gap-px overflow-hidden rounded-lg border border-[#27313b] bg-[#27313b]">
        <section aria-label="コピー元の要領書一覧" className={columnClassName}>
          <div className="mb-2 flex flex-wrap items-center gap-1.5 font-bold">
            <FilterChip value={modelFilter && (context?.modelCode || modelFilter)} fallback="全機種" removeLabel="機種の絞り込みを外す" onRemove={() => setModelFilter('')} />
            <span aria-hidden="true" className="text-[#9fadb9]">›</span>
            <FilterChip value={processFilter && context?.processName.split(' › ').at(-1)?.replace(/工程/g, '')} fallback="全工程" removeLabel="工程の絞り込みを外す" onRemove={() => setProcessFilter('')} />
          </div>
          <input ref={searchRef} type="search" aria-label="名前で絞り込み" placeholder="名前で絞り込み" value={nameFilter}
            onChange={event => setNameFilter(event.target.value)} className="mb-3 h-11 w-full rounded-lg border border-[#344252] bg-white px-3 text-[#0f1317] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5fc3e8]" />
          {listError ? <p role="alert" className="text-red-400">{listError}</p> : null}
          <div className="space-y-1.5">
            {filteredSources.map(({ row, usage }) => (
              <button key={row.id} type="button" aria-pressed={row.id === sourceId} onClick={() => selectSource(row.id)}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 rounded-lg border px-2.5 py-2 text-left ${row.id === sourceId ? 'border-[#5fc3e8] bg-[#27313b]' : 'border-[#344252]'}`}>
                <span className="break-words font-bold">{row.name}</span>
                <span className={`rounded border px-1.5 py-0.5 text-xs ${row.status === 'published' ? 'border-[#3ba776] text-[#8ad4b3]' : 'border-[#344252] text-[#9fadb9]'}`}>
                  {row.status === 'published' ? '公開' : '下書き'}
                </span>
                <span className="col-span-2 break-words text-sm text-[#9fadb9]">{[usage && [usage.modelCode, usage.processName.replace(/工程/g, '')].filter(Boolean).join(' › '), `${row.pages.length}ページ`].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
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
            {sourcePages.map(page => {
              const order = selectedIndexes.indexOf(page.pageIndex) + 1;
              return (
                <button key={page.pageIndex} type="button" aria-label={`${page.pageIndex + 1}ページ目`} aria-pressed={order > 0}
                  onClick={() => setSelectedIndexes(current => current.includes(page.pageIndex) ? current.filter(index => index !== page.pageIndex) : [...current, page.pageIndex])}
                  className={`relative rounded-md border-2 p-0.5 ${order > 0 ? 'border-[#5fc3e8]' : 'border-[#344252]'}`}>
                  <AssemblyProcedureDocumentEditorPagePreview page={page} assets={source?.assets} />
                  {order > 0 ? <span className="absolute right-1.5 top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-[#5fc3e8] px-1 font-mono text-sm font-bold text-[#0a0d10]">{order}</span> : null}
                </button>
              );
            })}
          </div>
        </section>
        <section aria-label="差し込み先のページ" className={columnClassName}>
          {position(-1)}
          {pages.map(page => <Fragment key={page.pageIndex}>
            <div className="mx-auto w-14" aria-label={`${page.pageIndex + 1}ページ目`}>
              <AssemblyProcedureDocumentEditorPagePreview page={page} assets={document.assets} />
            </div>
            {position(page.pageIndex)}
          </Fragment>)}
        </section>
      </fieldset>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {error ? <p role="alert" className="mr-auto text-red-400">{error}</p> : null}
        <button type="button" disabled={busy} className="rounded-lg border border-[#344252] px-5 py-3 font-semibold disabled:opacity-40" onClick={onClose}>やめる</button>
        <button type="button" disabled={disabled || busy || !selectedIndexes.length}
          className="rounded-lg bg-[#3ba776] px-5 py-3 font-bold text-[#0a0d10] disabled:opacity-40"
          onClick={() => void onImport(sourceId, selectedIndexes, afterPageIndex)}>{selectedIndexes.length}ページを入れる</button>
      </div>
    </Dialog>
  );
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
