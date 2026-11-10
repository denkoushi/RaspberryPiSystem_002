import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useProtectedImageBlobUrl } from '../../hooks/useProtectedImageBlobUrl';

import { boardPath } from './procedureBoardApi';
import { MAX_PAGES, applyPageOperation, pageOrder, boardItems, placeItem, removeItem } from './procedureBoardLayout';
import { formatPreview, useProcedureBoard } from './useProcedureBoard';

import type { Decision, Material, SuggestionSet } from './procedureBoardApi';
import type { BoardItem, BoardLayout, BoardTarget, PageOperation } from './procedureBoardLayout';
import type { PointerEvent as ReactPointerEvent } from 'react';
import './procedureBoard.css';

type Editing = { itemId: string; initial: string; created?: { item: BoardItem; target: BoardTarget } };
type Ghost = SuggestionSet['placements'][number];
const icon = (name: string, symbol: string, action: () => void, disabled = false) =>
  <button type="button" aria-label={name} onClick={action} disabled={disabled}>{symbol}</button>;
const rowTarget = (page: number, row: number): BoardTarget => ({ page, row, col: 0, index: 0, mode: 'row' });

const toolPaths = {
  title: <path d="M2.5 3h11M8 3v10.5" strokeWidth="2" />,
  subtitle: <><path d="M4 2.5h8M8 2.5v8" strokeWidth="1.7" /><path d="M2 14h12" strokeWidth="1.3" /></>,
  body: <path d="M2 3.5h12M2 6.5h12M2 9.5h12M2 12.5h7.5" />,
  dup: <><rect x="5" y="5" width="9" height="9" rx="1.5" /><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" /></>,
  add: <path d="M8 2.5v11M2.5 8h11" strokeWidth="1.8" />,
  del: <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.8v4.4M9.2 6.8v4.4" />,
};
type PageToolsProps = { page: number; total: number; disabled: boolean; duplicateEnabled: boolean;
  addText: (kind: 'title' | 'subtitle' | 'body', page: number) => void; duplicate: (page: number) => void;
  operate: (operation: PageOperation) => void };
function PageTools({ page, total, disabled, duplicateEnabled, addText, duplicate, operate }: PageToolsProps) {
  const [asking, setAsking] = useState(false); const wrap = useRef<HTMLSpanElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null); const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!asking) return;
    cancelButton.current?.focus();
    const close = () => { setAsking(false); deleteButton.current?.focus(); };
    const outside = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setAsking(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const buttons = wrap.current?.querySelectorAll<HTMLButtonElement>('.pb-delete-ask button');
        if (buttons?.length) { event.preventDefault(); (document.activeElement === buttons[0] ? buttons[1] : buttons[0]).focus(); }
      }
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); };
  }, [asking]);
  const tool = (name: string, path: keyof typeof toolPaths, action: () => void, off = disabled) =>
    <button className="pb-pt" type="button" aria-label={name} data-tip={name} disabled={off} onClick={action}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{toolPaths[path]}</svg>
    </button>;
  return <div className="pb-page-tools">
    {tool('タイトル', 'title', () => addText('title', page))}
    {tool('サブタイトル', 'subtitle', () => addText('subtitle', page))}
    {tool('本文', 'body', () => addText('body', page))}
    <span className="pb-separator" aria-hidden="true" />
    {tool('複製', 'dup', () => duplicate(page), disabled || !duplicateEnabled)}
    {tool('ページ追加', 'add', () => operate({ type: 'page_added', payload: { page: page + 1 } }), disabled || total >= MAX_PAGES)}
    <span className="pb-delete-wrap" ref={wrap}>
      <button ref={deleteButton} className={`pb-pt${asking ? ' pb-armed' : ''}`} type="button" aria-label="ページ削除" data-tip="ページ削除" disabled={disabled || total <= 1} onClick={() => setAsking(value => !value)}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{toolPaths.del}</svg>
      </button>
      {asking && <div className="pb-delete-ask" role="alertdialog" aria-modal="true" aria-label={`ページ${page}を削除`}>
        <b>ページ{page}を削除しますか?</b><div>
          <button ref={cancelButton} type="button" onClick={() => { setAsking(false); deleteButton.current?.focus(); }}>やめる</button>
          <button className="pb-danger" type="button" disabled={disabled} onClick={() => { setAsking(false); operate({ type: 'page_removed', payload: { page } }); }}>削除</button>
        </div>
      </div>}
    </span>
  </div>;
}

const Photo = memo(function Photo({ path }: { path: string }) {
  const holder = useRef<HTMLSpanElement>(null); const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = holder.current; if (!node) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    });
    observer.observe(node); return () => observer.disconnect();
  }, []);
  return <span className="pb-photo" ref={holder}>{visible && <ProtectedPhoto path={path} />}</span>;
});
function ProtectedPhoto({ path }: { path: string }) {
  const { blobUrl } = useProtectedImageBlobUrl(path);
  return blobUrl ? <img src={blobUrl} alt="" width={160} height={100} loading="lazy" draggable={false} /> : null;
}
function MaterialMeta({ material }: { material: Material }) {
  return <span className="pb-meta"><time dateTime={material.createdAt}>{material.createdAt.slice(5, 10)}</time><span role="img" aria-label={material.pdf ? 'PDF' : material.images.length ? '写真' : 'メモ'}>{material.pdf ? '▤' : material.images.length ? '▧' : '≡'}</span>{material.pdf && <span>{material.pdf.pageNumber}</span>}</span>;
}
function Editor({ initial, commit, cancel, disabled }: { initial: string; commit: (text: string) => void; cancel: () => void; disabled: boolean }) {
  const [text, setText] = useState(initial); const done = useRef(false); const composing = useRef(false);
  const finish = (save: boolean) => { if (done.current) return; done.current = true; if (save) commit(text); else cancel(); };
  return <textarea aria-label="本文を編集" autoFocus value={text} maxLength={12000} readOnly={disabled}
    onChange={event => setText(event.target.value)} onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }} onBlur={() => { if (!disabled) finish(true); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      if (event.key === 'Enter' && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) {
        event.preventDefault(); if (!disabled) finish(true);
      }
    }} />;
}
type CardProps = { procedureId: string; item?: BoardItem; material?: Material; ghost?: Ghost; selected?: boolean;
  editing?: Editing; stale?: boolean; disabled: boolean; page?: number; row?: number; col?: number; index?: number; count?: number;
  begin: (id: string) => void; select: (id: string) => void; commit: (text: string) => void; cancel: () => void;
  remove: (id: string) => void; decide: (decision: Decision) => void; shown: (id: string) => void };
const Card = memo(function Card({ procedureId, item, material, ghost, selected, editing, stale, disabled, page, row, col, index, count, begin, select, commit, cancel, remove, decide, shown }: CardProps) {
  const node = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!ghost || stale || !node.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) shown(ghost.id); });
    observer.observe(node.current); return () => observer.disconnect();
  }, [ghost, shown, stale]);
  const text = item?.kind === 'text' ? item.text : item?.kind === 'material' ? item.override ?? material?.text ?? '素材がありません' : material?.text ?? '';
  return <article ref={node} tabIndex={0} aria-label={ghost ? `提案 ${text}` : text || '新しい本文'} aria-current={item && selected ? 'true' : undefined}
    className={`pb-card pb-${item?.style ?? (material?.images.length ? 'figure' : 'body')}${item && material?.images.length && item.style !== 'figure' ? ' pb-image-body' : ''}${ghost ? ' pb-ghost' : ''}${stale ? ' pb-stale' : ''}${selected ? ' pb-selected' : ''}`}
    data-item={item?.itemId} data-material={material?.materialId} data-ghost={ghost?.id}
    data-page={page} data-row={row} data-col={col} data-index={index} data-count={count}
    onFocus={() => { if (item) select(item.itemId); }} onClick={() => { if (item) select(item.itemId); }}
    onKeyDown={event => {
      if (event.target instanceof HTMLTextAreaElement) return;
      if (event.key === 'Enter' && item && !disabled) { event.preventDefault(); begin(item.itemId); }
    }}>
    {material && <MaterialMeta material={material} />}
    {material && !material.images.length && <span className="pb-memo-picture" aria-hidden="true" />}
    {material?.images.map(image => <Photo key={image.id} path={`${boardPath(procedureId)}/materials/${encodeURIComponent(material.materialId)}/images/${image.id}`} />)}
    {editing ? <Editor key={editing.itemId} initial={editing.initial} commit={commit} cancel={cancel} disabled={disabled} />
      : <span className="pb-text" onClick={() => { if (item && !disabled) begin(item.itemId); }}>{text}</span>}
    {ghost ? <span className="pb-actions">
      {icon('ここに置く', '✓', () => decide({ proposalId: ghost.id, action: 'accept', itemId: crypto.randomUUID() }), disabled || stale)}
      {icon('提案を外す', '×', () => decide({ proposalId: ghost.id, action: 'dismiss' }), disabled || stale)}
    </span> : item && selected && !editing ? icon('外す', '×', () => remove(item.itemId), disabled) : null}
  </article>;
});

type ContentsEntry = { itemId: string; text: string };

type PageProps = { tools?: PageToolsProps; total: number; page: BoardLayout['pages'][number]; procedureId: string; materials: Map<string, Material>;
  contents?: ContentsEntry[]; set?: SuggestionSet | null; stale: boolean; collapsed: boolean; toggle: (page: number) => void; selected?: string;
  editing?: Editing; disabled: boolean; begin: CardProps['begin']; select: CardProps['select']; commit: CardProps['commit'];
  cancel: CardProps['cancel']; remove: CardProps['remove']; decide: CardProps['decide']; shown: CardProps['shown']; resize: (page: number, row: number, col: number, value: number) => void };
const Page = memo(function Page({ page, tools, total, contents, procedureId, materials, set, stale, collapsed, toggle, selected, editing, disabled, begin, select, commit, cancel, remove, decide, shown, resize }: PageProps) {
  const heading = set?.headings.find(heading => heading.page === page.page);
  const ghosts = set?.placements.filter(ghost => ghost.page === page.page) ?? [];
  const shared = { procedureId, disabled, begin, select, commit, cancel, remove, decide, shown };
  const ghostCard = (ghost: Ghost) => <Card key={`ghost:${ghost.id}`} {...shared} ghost={ghost} material={materials.get(ghost.materialId)} stale={stale} />;
  const contentsAfterTitle = page.rows[0]?.cols[0]?.items[0]?.style === 'heading';
  const contentsNav = !!contents?.length && <nav className="pb-contents" aria-label="目次"><b>目次</b>
    {contents.map(entry => <button type="button" key={entry.itemId} onClick={event => {
      const target = event.currentTarget.closest('.procedure-board')?.querySelector(`[data-item="${entry.itemId}"]`);
      target?.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }}>{entry.text}</button>)}
  </nav>;
  return <section className={`pb-pane pb-page${collapsed ? ' pb-collapsed' : ''}`} data-drop={page.page} aria-label={`ページ${page.page}`} onClick={event => { if (collapsed && !(event.target as HTMLElement).closest('button')) toggle(page.page); }}>
    <header data-page-handle={tools ? page.page : undefined}><span className="pb-page-number">{page.page}</span><span className="pb-page-total">/ {total}</span>
      {tools && <PageTools {...tools} />}
      {icon(collapsed ? `ページ${page.page}を開く` : `ページ${page.page}を閉じる`, collapsed ? '+' : '−', () => toggle(page.page))}
    </header>
    {!collapsed && <div className="pb-scroll">
      {page.heading && <h2 className="pb-page-heading">{page.heading}</h2>}
      {!contentsAfterTitle && contentsNav}
      {!page.heading && heading && <div data-ghost={heading.id} className={`pb-card pb-ghost pb-heading-ghost${stale ? ' pb-stale' : ''}`}><strong>{heading.text}</strong><span className="pb-actions">
        {icon('見出しにする', '✓', () => decide({ proposalId: heading.id, action: 'accept', itemId: crypto.randomUUID() }), disabled || stale)}
        {icon('見出しを外す', '×', () => decide({ proposalId: heading.id, action: 'dismiss' }), disabled || stale)}</span></div>}
      {Array.from({ length: page.rows.length + 1 }, (_, r) => {
        const row = page.rows[r];
        return <Fragment key={r}><div className="pb-row-group">
          {ghosts.filter(ghost => ghost.mode === 'row' && ghost.row === r).map(ghostCard)}
          {row && (() => {
            const columns: { index: number; ghost?: Ghost }[] = row.cols.map((_, index) => ({ index }));
            const beside = ghosts.filter(ghost => ghost.mode === 'col' && ghost.row === r);
            for (const ghost of [...beside].sort((a, b) => b.col - a.col)) columns.splice(ghost.col, 0, { index: ghost.col, ghost });
            const widths = beside.length ? columns.map(column => {
              if (columns.length !== 2) return 1 / columns.length;
              const figure = column.ghost ? !!materials.get(column.ghost.materialId)?.images.length : row.cols[column.index].items.every(item => item.style === 'figure');
              return figure ? 1 / 3 : 2 / 3;
            }) : row.w;
            return <div className="pb-row" data-layout-row={r} style={{ gridTemplateColumns: widths.map(w => `minmax(0,${w}fr)`).join(' 20px ') }}>
              {columns.map((column, viewIndex) => <div className="pb-column-pair" key={column.ghost ? `ghost:${column.ghost.id}` : column.index}>
                {viewIndex > 0 && (beside.length ? <span /> : <input type="range" min={15} max={Math.round((row.w[column.index - 1] + row.w[column.index]) * 100 - 15)} value={Math.round(row.w[column.index - 1] * 100)}
                  aria-label={`ページ${page.page} 行${r + 1} 列${column.index}の幅`} className="pb-split" disabled={disabled} data-resize-col={column.index - 1}
                  data-resize-page={page.page} data-resize-row={r}
                  onChange={event => resize(page.page, r, column.index - 1, Number(event.target.value) / 100)} />)}
                <div className="pb-column">{column.ghost ? ghostCard(column.ghost) : <>
                  {row.cols[column.index].items.map((item, index) => <div className="pb-item-slot" key={item.itemId}>
                    {ghosts.filter(ghost => ghost.mode === 'in' && ghost.row === r && ghost.col === column.index && ghost.index === index).map(ghostCard)}
                    <Card {...shared} item={item} material={item.kind === 'material' ? materials.get(item.materialId) : undefined}
                      page={page.page} row={r} col={column.index} index={index} count={row.cols.length} selected={selected === item.itemId}
                      editing={editing?.itemId === item.itemId ? editing : undefined} />
                  </div>)}
                  {ghosts.filter(ghost => ghost.mode === 'in' && ghost.row === r && ghost.col === column.index && ghost.index === row.cols[column.index].items.length).map(ghostCard)}
                </>}</div>
              </div>)}
            </div>;
          })()}
          {set?.gaps.filter(gap => gap.page === page.page && gap.row === r).map(gap => <div className="pb-gap" key={gap.id}><b>?</b> {gap.text}</div>)}
        </div>{r === 0 && contentsAfterTitle && contentsNav}</Fragment>;
      })}
      {page.rows.length === 0 && ghosts.length === 0 && <div className="pb-empty">{page.page}</div>}
    </div>}
  </section>;
});

type Drag = { pageMove?: { from: number; to: number }; node: HTMLElement; x: number; y: number; nowX: number; nowY: number; on: boolean; itemId?: string; materialId?: string;
  geometry?: Map<HTMLElement, { rect: DOMRect; cards: { itemId: string; box: DOMRect }[] }>; sourceWidth?: number;
  ghostId?: string; target?: BoardTarget; tray?: boolean; base: BoardLayout; positions: Map<string, ReturnType<typeof boardItems>[number]['at']>; hold?: ReturnType<typeof setTimeout>; waiting?: boolean; resize?: { page: number; row: number; col: number; widths: number[]; width: number; now: number[] } };
export function ProcedureBoard({ procedureId, title, materials: materialList, materialError }: { procedureId: string; title: string; materials: Material[]; materialError?: unknown }) {
  const state = useProcedureBoard(procedureId); const { session, draft } = state;
  useEffect(() => { if (materialError) void session.readError(materialError); }, [materialError, session]);
  const [selected, setSelected] = useState<string>(); const [editing, setEditing] = useState<Editing>();
  const [closed, setClosed] = useState<number[]>([]); const root = useRef<HTMLDivElement>(null); const indicator = useRef<HTMLDivElement>(null);
  const lift = useRef<HTMLDivElement>(null); const pages = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | undefined>(undefined); const frame = useRef(0); const skipClick = useRef(false);
  const disabled = state.forbidden || state.stopped;
  const live = useRef({ draft, editing, disabled });
  live.current = { draft, editing, disabled };
  const toggle = useCallback((page: number) => setClosed(list => list.includes(page) ? list.filter(p => p !== page) : [...list, page]), []);
  const materials = useMemo(() => new Map(materialList.map(material => [material.materialId, material])), [materialList]);
  const endEdit = useCallback(() => { live.current.editing = undefined; setEditing(undefined); session.busy(false); }, [session]);
  const begin = useCallback((id: string) => {
    const { draft, editing, disabled } = live.current;
    if (disabled || !draft || editing) return;
    const item = boardItems(draft).find(entry => entry.item.itemId === id)?.item; if (!item) return;
    const next = { itemId: id, initial: item.kind === 'text' ? item.text : item.override ?? materials.get(item.materialId)?.text ?? '' };
    live.current.editing = next;
    setSelected(id); session.busy(true); setEditing(next);
  }, [materials, session]);
  const commit = useCallback((text: string) => {
    const { editing, disabled } = live.current;
    if (!editing || disabled) return;
    if (editing.created) {
      if (text.trim()) session.change(layout => {
        const item = { ...editing.created!.item, text } as BoardItem;
        return { layout: placeItem(layout, item, editing.created!.target), event: { type: 'text_created', payload: { itemId: item.itemId } } };
      });
    } else if (text.trim()) session.change(layout => ({ layout: { ...layout, pages: layout.pages.map(page => ({ ...page,
      rows: page.rows.map(row => ({ ...row, cols: row.cols.map(col => ({ items: col.items.map(item => item.itemId === editing.itemId
        ? item.kind === 'text' ? { ...item, text } : { ...item, override: text } : item) })) })) })) },
      event: { type: 'text_edited', payload: { itemId: editing.itemId } } }), `text:${editing.itemId}`);
    endEdit();
  }, [endEdit, session]);
  const remove = useCallback((id: string) => session.change(layout => ({ layout: removeItem(layout, id), event: { type: 'item_removed', payload: { itemId: id } } })), [session]);
  const resize = useCallback((page: number, row: number, col: number, value: number) => session.change(layout => {
    const result = structuredClone(layout); const widths = result.pages[page - 1].rows[row].w;
    const pair = widths[col] + widths[col + 1]; const left = Math.min(pair - .15, Math.max(.15, value));
    widths[col] = left; widths[col + 1] = pair - left;
    return { layout: result, event: { type: 'columns_resized', payload: { page, row } } };
  }, `width:${page}:${row}`), [session]);
  const selectedAt = useMemo(() => draft && boardItems(draft).find(entry => entry.item.itemId === selected), [draft, selected]);
  const insertTarget = useCallback((page: number, title = false): BoardTarget => selectedAt?.at.page === page
    ? rowTarget(page, selectedAt.at.row + 1)
    : rowTarget(page, title ? 0 : draft?.pages[page - 1].rows.length ?? 0), [draft, selectedAt]);
  const addText = useCallback((textKind: 'title' | 'subtitle' | 'body', page: number) => {
    const item: BoardItem = { itemId: crypto.randomUUID(), kind: 'text', textKind, text: '', origin: 'human', style: { title: 'heading', subtitle: 'subheading', body: 'body' }[textKind] as BoardItem['style'] };
    setSelected(item.itemId); session.busy(true); setEditing({ itemId: item.itemId, initial: '', created: { item, target: insertTarget(page, textKind === 'title') } });
  }, [insertTarget, session]);
  const duplicate = useCallback((page: number) => {
    if (!selectedAt || selectedAt.at.page !== page) return; const item = { ...selectedAt.item, itemId: crypto.randomUUID() }; const target = insertTarget(page);
    session.change(layout => ({ layout: placeItem(layout, item, target), event: { type: 'item_duplicated', payload: { itemId: item.itemId, sourceItemId: selectedAt.item.itemId } } })); setSelected(item.itemId);
  }, [insertTarget, selectedAt, session]);
  const operate = useCallback((operation: PageOperation) => {
    if (!draft || disabled || editing) return;
    const order = pageOrder(draft.pages.length, operation);
    session.change(layout => ({ layout: applyPageOperation(layout, operation), event: operation }));
    setClosed(list => list.flatMap(page => page === 0 ? [0] : order.includes(page) ? [order.indexOf(page) + 1] : []));
    if (operation.type === 'page_removed' && selectedAt?.at.page === operation.payload.page) setSelected(undefined);
  }, [disabled, draft, editing, selectedAt, session]);
  const toolsByPage = useMemo(() => draft?.pages.map(page => ({ page: page.page, total: draft.pages.length, disabled: disabled || !!editing, duplicateEnabled: selectedAt?.at.page === page.page, addText, duplicate, operate })), [addText, disabled, draft, duplicate, editing, operate, selectedAt]);
  const set = state.suggestions?.current ?? state.suggestions?.previous;
  const stale = !set || !!set.stale || set.boardVersion !== state.board?.version || state.pending > 0 || state.stopped;
  const proposals = useRef({ set, stale }); proposals.current = { set, stale };
  const decide = useCallback((decision: Decision) => {
    const { set, stale } = proposals.current;
    if (set && !stale) session.decide(set.id, decision);
  }, [session]);
  const contents = useMemo(() => draft ? boardItems(draft).flatMap(({ item }) =>
    item.kind === 'text' && item.style === 'subheading' ? [{ itemId: item.itemId, text: item.text }] : []) : [], [draft]);
  const placed = useMemo(() => new Set(draft ? boardItems(draft).flatMap(({ item }) => item.kind === 'material' ? [item.materialId] : []) : []), [draft]);
  const visibleSet = useMemo(() => set ? { ...set, placements: set.placements.filter(p => !placed.has(p.materialId)) } : null, [placed, set]);
  const preview = draft && state.format?.boardVersion === state.board?.version && state.pending === 0 ? formatPreview(draft, state.format) : undefined;
  let display = draft;
  if (editing?.created && display) display = placeItem(display, editing.created.item, editing.created.target);
  const applyPlacement = (item: BoardItem, target: BoardTarget, moving: boolean) => session.change(layout => {
    const from = boardItems(layout).find(entry => entry.item.itemId === item.itemId)?.at;
    const result = placeItem(layout, item, target); const to = boardItems(result).find(entry => entry.item.itemId === item.itemId)!.at;
    return { layout: result, event: moving ? { type: 'item_moved', payload: { itemId: item.itemId, from, to } }
      : { type: 'material_placed', payload: { itemId: item.itemId, materialId: item.kind === 'material' ? item.materialId : undefined, to } } };
  });
  const cleanupDrag = useCallback(() => {
    cancelAnimationFrame(frame.current); frame.current = 0;
    clearTimeout(drag.current?.hold);
    if (indicator.current) indicator.current.hidden = true;
    drag.current?.node.classList.remove('pb-dragging', 'pb-page-moving');
    if (lift.current) { lift.current.replaceChildren(); lift.current.style.width = ''; lift.current.hidden = true; }
    drag.current = undefined; session.busy(false);
  }, [session]);
  useEffect(() => () => { cancelAnimationFrame(frame.current); clearTimeout(drag.current?.hold); }, []);
  useEffect(() => { if (disabled && drag.current) cleanupDrag(); }, [disabled, cleanupDrag]);
  function measurePages(d: Drag) {
    return new Map([...root.current!.querySelectorAll<HTMLElement>('.pb-page[data-drop]')].map(page => [page, {
      rect: page.getBoundingClientRect(),
      cards: [...page.querySelectorAll<HTMLElement>('[data-item]')].filter(node => node.dataset.item !== d.itemId)
        .map(node => ({ itemId: node.dataset.item!, box: node.getBoundingClientRect() })),
    }]));
  }
  function step() {
    frame.current = 0; const d = drag.current; if (!d || d.waiting) return;
    if (d.pageMove) {
      if (!d.on && Math.hypot(d.nowX - d.x, d.nowY - d.y) < 6) return;
      d.on = true; d.node.classList.add('pb-page-moving');
      const band = pages.current; if (!band) return;
      const bounds = band.getBoundingClientRect(); const priorScroll = band.scrollLeft;
      if (d.nowX < bounds.left + 48) band.scrollLeft -= 14;
      else if (d.nowX > bounds.right - 48) band.scrollLeft += 14;
      const boxes = [...band.children].map(node => node.getBoundingClientRect());
      const at = boxes.findIndex(box => d.nowX < box.left + box.width / 2);
      const slot = at < 0 ? boxes.length : at;
      d.pageMove.to = slot > d.pageMove.from - 1 ? slot : slot + 1;
      const edge = at < 0 ? boxes[boxes.length - 1].right + 3 : boxes[at].left - 5.5;
      const left = Math.max(bounds.left, Math.min(bounds.right - 3, edge));
      if (lift.current) {
        lift.current.className = 'pb-lift pb-page-lift'; lift.current.textContent = String(d.pageMove.from); lift.current.hidden = false;
        lift.current.style.transform = `translate3d(${d.nowX - 14}px,${d.nowY - 18}px,0)`;
      }
      if (indicator.current) {
        indicator.current.hidden = d.pageMove.to === d.pageMove.from;
        indicator.current.dataset.direction = 'vertical';
        Object.assign(indicator.current.style, { left: `${left}px`, top: `${bounds.top}px`, width: '3px', height: `${bounds.height}px` });
      }
      if (band.scrollLeft !== priorScroll) frame.current = requestAnimationFrame(step);
      return;
    }
    if (d.resize) {
      const r = d.resize; const pair = r.widths[r.col] + r.widths[r.col + 1];
      const left = Math.min(pair - .15, Math.max(.15, r.widths[r.col] + (d.nowX - d.x) / r.width));
      r.now = [...r.widths]; r.now[r.col] = left; r.now[r.col + 1] = pair - left;
      d.node.style.gridTemplateColumns = r.now.map(w => `minmax(0,${w}fr)`).join(' 20px '); return;
    }
    if (!d.on && Math.hypot(d.nowX - d.x, d.nowY - d.y) < 6) return;
    // Finish geometry reads before writing the clone, transform or indicator.
    const hit = document.elementFromPoint(d.nowX, d.nowY)?.closest<HTMLElement>('[data-drop]');
    d.geometry ??= measurePages(d);
    if (!d.on && lift.current) {
      const clone = d.node.cloneNode(true) as HTMLElement;
      clone.removeAttribute('tabindex'); clone.removeAttribute('aria-current'); clone.setAttribute('inert', '');
      clone.querySelectorAll('[tabindex],button,textarea').forEach(node => node.setAttribute('tabindex', '-1'));
      lift.current.className = `pb-lift ${d.node.closest('.pb-tray') ? 'pb-tray' : 'pb-page'}`;
      lift.current.replaceChildren(clone); lift.current.hidden = false;
      lift.current.style.width = `${Math.min(d.sourceWidth!, 238)}px`;
      d.node.classList.add('pb-dragging');
    }
    d.on = true;
    if (lift.current) lift.current.style.transform = `translate3d(${d.nowX - 28}px,${d.nowY - 14}px,0)`;
    d.target = undefined; d.tray = hit?.dataset.drop === 'tray';
    if (!hit || d.tray) { if (indicator.current) indicator.current.hidden = true; return; }
    const page = Number(hit.dataset.drop); const basePage = d.base.pages[page - 1];
    const geometry = d.geometry.get(hit); if (!geometry) return;
    let target = rowTarget(page, basePage.rows.length); let rect = geometry.rect;
    for (const { itemId, box } of geometry.cards) {
      const at = d.positions.get(itemId); if (!at) continue;
      if (d.nowY < box.top) { target = rowTarget(page, at.row); break; }
      if (d.nowX >= box.left && d.nowX <= box.right && d.nowY >= box.top && d.nowY <= box.bottom) {
        rect = box; const ratio = (d.nowX - box.left) / box.width; const after = d.nowY > box.top + box.height / 2;
        const count = basePage.rows[at.row].cols.length;
        if (count < 3 && (ratio < .22 || ratio > .78)) {
          target = { ...at, col: at.col + (ratio > .78 ? 1 : 0), index: 0, mode: 'col' };
          rect = new DOMRect(ratio < .22 ? box.left : box.right - 12, box.top, 12, box.height);
        } else {
          target = count > 1 ? { ...at, index: at.index + (after ? 1 : 0), mode: 'in' } : rowTarget(page, at.row + (after ? 1 : 0));
          rect = new DOMRect(box.left, after ? box.bottom - 8 : box.top, box.width, 8);
        }
        break;
      }
    }
    d.target = target;
    if (indicator.current) {
      indicator.current.hidden = false;
      indicator.current.dataset.direction = target.mode === 'col' ? 'vertical' : 'horizontal';
      Object.assign(indicator.current.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    }
  }
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !draft || editing || event.button !== 0) return;
    const element = event.target as HTMLElement;
    session.touch(element.closest<HTMLElement>('[data-material]')?.dataset.material);
    const handle = element.closest<HTMLElement>('[data-page-handle]');
    if (handle && !element.closest('button,.pb-delete-ask')) {
      const from = Number(handle.dataset.pageHandle);
      const d: Drag = { node: handle.closest<HTMLElement>('.pb-page')!, x: event.clientX, y: event.clientY,
        nowX: event.clientX, nowY: event.clientY, on: false, base: draft, positions: new Map(),
        pageMove: { from, to: from }, waiting: event.pointerType === 'touch' };
      drag.current = d;
      if (d.waiting) {
        d.hold = setTimeout(() => {
          if (drag.current !== d || live.current.disabled) return;
          d.waiting = false; d.on = true; session.busy(true); handle.setPointerCapture?.(event.pointerId); step();
        }, 250);
      } else { event.preventDefault(); session.busy(true); handle.setPointerCapture?.(event.pointerId); }
      return;
    }
    const split = element.closest<HTMLInputElement>('[data-resize-col]');
    if (split) {
      event.preventDefault(); split.focus();
      const page = Number(split.dataset.resizePage), row = Number(split.dataset.resizeRow), col = Number(split.dataset.resizeCol);
      const rowNode = split.closest<HTMLElement>('.pb-row')!; const widths = [...draft.pages[page - 1].rows[row].w];
      drag.current = { node: rowNode, x: event.clientX, y: event.clientY, nowX: event.clientX, nowY: event.clientY, on: true, base: draft, positions: new Map(),
        resize: { page, row, col, widths, width: Math.max(1, rowNode.clientWidth - 20 * (widths.length - 1)), now: widths } };
    } else {
      if (element.closest('button,textarea,a,input')) return;
      const node = element.closest<HTMLElement>('.pb-card'); if (!node) return;
      const { item: itemId, material: materialId, ghost: ghostId } = node.dataset;
      if (ghostId && stale) return;
      const base = itemId ? removeItem(draft, itemId) : draft;
      const d: Drag = { node, itemId, materialId, ghostId, x: event.clientX, y: event.clientY, nowX: event.clientX, nowY: event.clientY, on: false,
        base, positions: new Map(boardItems(base).map(({ item, at }) => [item.itemId, at])), waiting: event.pointerType === 'touch' };
      d.sourceWidth = node.getBoundingClientRect().width;
      d.geometry = measurePages(d);
      drag.current = d;
      if (d.waiting) {
        d.hold = setTimeout(() => {
          if (drag.current !== d || live.current.disabled) return;
          d.waiting = false; session.busy(true); element.setPointerCapture?.(event.pointerId);
        }, 250);
        return;
      }
    }
    session.busy(true); element.setPointerCapture?.(event.pointerId);
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>, cancel = false) => {
    const d = drag.current; if (!d) return;
    cancelAnimationFrame(frame.current); frame.current = 0;
    if (!cancel) { d.nowX = event.clientX; d.nowY = event.clientY; step(); }
    if (!cancel && !disabled && d.on) {
      skipClick.current = true; setTimeout(() => { skipClick.current = false; }, 0);
      if (d.pageMove) { if (d.pageMove.from !== d.pageMove.to) operate({ type: 'page_moved', payload: d.pageMove }); }
      else if (d.resize) { const r = d.resize; if (r.now[r.col] !== r.widths[r.col]) resize(r.page, r.row, r.col, r.now[r.col]); }
      else if (d.tray && d.itemId) remove(d.itemId);
      else if (d.tray && d.ghostId) decide({ proposalId: d.ghostId, action: 'dismiss' });
      else if (d.target) {
        if (d.ghostId) {
          const heading = set?.headings.find(ghost => ghost.id === d.ghostId);
          const ghost = set?.placements.find(ghost => ghost.id === d.ghostId) ?? (heading && rowTarget(heading.page, 0));
          const same = ghost && (['page', 'row', 'col', 'index', 'mode'] as const).every(key => ghost[key] === d.target![key]);
          decide(same ? { proposalId: d.ghostId, action: 'accept', itemId: crypto.randomUUID() } : { proposalId: d.ghostId, action: 'relocate', itemId: crypto.randomUUID(), target: d.target });
        }
        else {
          const material = d.materialId && materials.get(d.materialId);
          const item: BoardItem | undefined = d.itemId ? boardItems(draft!).find(entry => entry.item.itemId === d.itemId)?.item : material ? {
            itemId: crypto.randomUUID(), kind: 'material', materialId: material.materialId, origin: 'human', style: material.images.length || material.pdf ? 'figure' : 'body' } : undefined;
          if (item) applyPlacement(item, d.target, !!d.itemId);
        }
      }
    }
    if (cancel && d.resize) d.node.style.gridTemplateColumns = d.resize.widths.map(w => `minmax(0,${w}fr)`).join(' 20px ');
    cleanupDrag(); (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) cleanupDrag(); };
    document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape);
  }, [cleanupDrag]);
  const shared = { procedureId, materials, disabled, begin, select: setSelected, commit, cancel: endEdit, remove, decide, shown: session.show, resize };
  return <div className="procedure-board" ref={root} onPointerDown={pointerDown}
    onScrollCapture={() => { if (drag.current) drag.current.geometry = undefined; }}
    onInput={() => session.touch()} onPointerMove={event => { const d = drag.current; if (!d) return; if (d.waiting && (event.clientX !== d.x || event.clientY !== d.y)) { cleanupDrag(); return; } session.touch(); d.nowX = event.clientX; d.nowY = event.clientY; if (!frame.current) frame.current = requestAnimationFrame(step); }}
    onPointerUp={event => pointerUp(event)} onPointerCancel={event => pointerUp(event, true)}
    onLostPointerCapture={() => { if (drag.current) cleanupDrag(); }}
    onClickCapture={event => { if (skipClick.current) { event.stopPropagation(); event.preventDefault(); skipClick.current = false; } }}
    onFocusCapture={event => session.touch((event.target as HTMLElement).closest<HTMLElement>('[data-material]')?.dataset.material)}
    onKeyDown={event => { session.touch(); if (event.key === 'Delete' && selected && !editing && !disabled && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); remove(selected); } }}>
    <div className="pb-bar">
      <div className="pb-title-group"><Link className="pb-back" to="/kiosk/procedure-board" aria-label="案件選択">‹</Link><h1>{title}</h1></div>
      <span className="pb-spacer" />
      {state.suggestions && ['pending', 'running', 'deferred'].includes(state.suggestions.status) && <span className="pb-status" role="status"><i aria-hidden="true" />解析中</span>}
      {state.format && ['pending', 'running', 'deferred'].includes(state.format.status) && <span className="pb-status" role="status"><i aria-hidden="true" />整形中</span>}
      {state.board?.stats && <span className="pb-stats"><span>採用 <b>{state.board.stats.accepted}</b></span><span>修正 <b>{state.board.stats.modified}</b></span><span>手動 <b>{state.board.stats.manual}</b></span></span>}
      {state.format ? <><button className="pb-outline" type="button" onClick={() => session.decideFormat('revert')} disabled={disabled}>戻す</button>
        <button className="pb-primary" type="button" onClick={() => session.decideFormat('accept')} disabled={!preview || disabled}>採用</button></>
        : <button className="pb-primary" type="button" disabled={disabled || state.stopped} onClick={session.requestFormat}>AIで整える</button>}
      {state.error && <span role="alert">{state.error}</span>}
      {state.latest ? icon('最新から再開', '↻', session.latest, state.forbidden) : state.stopped && icon('最新を取得', '↻', () => void session.refresh(), state.forbidden)}
      {state.recovery && icon('下書きを表示', '▤', session.recover)}
    </div>
    {display ? <div className="pb-main" style={{ gridTemplateColumns: `${closed.includes(0) ? 'var(--pb-strip)' : 'var(--pb-tray)'} minmax(0,1fr)` }}>
      <section className={`pb-pane pb-tray${closed.includes(0) ? ' pb-collapsed' : ''}`} data-drop="tray" aria-label="素材" onClick={event => { if (closed.includes(0) && !(event.target as HTMLElement).closest('button')) setClosed(list => list.filter(p => p !== 0)); }}>
        <header><h2>素材</h2><span>{materialList.length - placed.size}</span>{icon(closed.includes(0) ? '素材を開く' : '素材を閉じる', closed.includes(0) ? '+' : '−', () => setClosed(list => list.includes(0) ? list.filter(p => p !== 0) : [...list, 0]))}</header>
        {!closed.includes(0) && <div className="pb-scroll">{materialList.filter(material => !placed.has(material.materialId)).map(material => <Card key={material.materialId} {...shared} material={material} />)}
          {visibleSet?.conflicts.map(conflict => <div className="pb-conflict" key={conflict.id} role="group" aria-label="食い違い">
            <div className="pb-conflict-heading"><span aria-hidden="true">⚠</span>食い違い</div><div className="pb-conflict-options">{conflict.materialIds.map((id, i) => {
              const material = materials.get(id);
              return <button type="button" key={id} disabled={stale || disabled} onClick={() => decide({ proposalId: conflict.id, action: 'select_conflict', selectedMaterialId: id })}>{conflict.quotes[i]}
                {material && <small><time dateTime={material.createdAt}>{material.createdAt.slice(5, 10)}</time> {material.pdf ? 'PDF' : material.images.length ? '写真' : 'メモ'}</small>}</button>;
            })}</div></div>)}
        </div>}
      </section>
      <div className="pb-pages" ref={pages}>{display.pages.map(page => <Page key={page.page} {...shared} page={page} total={display.pages.length} tools={toolsByPage?.[page.page - 1]} set={visibleSet} stale={stale} collapsed={closed.includes(page.page)}
        toggle={toggle} contents={page.page === 1 ? contents : undefined}
        selected={boardItems({ ...display!, pages: [page] }).some(entry => entry.item.itemId === selected) ? selected : undefined}
        editing={editing} />)}</div>
    </div> : <p role="status">{state.forbidden ? '手順づくりは無効です' : '読み込み中…'}</p>}
    {preview && <div className="pb-preview" aria-label="整形プレビュー" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><div className="pb-preview-panel">
      <header><strong>{title}</strong><span className="pb-spacer" />
        <button className="pb-outline" type="button" onClick={() => session.decideFormat('revert')} disabled={disabled}>戻す</button>
        <button className="pb-primary" type="button" onClick={() => session.decideFormat('accept')} disabled={disabled}>採用</button></header>
      <div className="pb-preview-pages">{preview.pages.map(page => <Page key={page.page} {...shared} page={page} total={preview.pages.length} stale collapsed={false} toggle={toggle} disabled />)}</div>
    </div></div>}
    <div ref={lift} className="pb-lift" aria-hidden="true" hidden />
    <div ref={indicator} className="pb-drop-indicator" hidden />
  </div>;
}
