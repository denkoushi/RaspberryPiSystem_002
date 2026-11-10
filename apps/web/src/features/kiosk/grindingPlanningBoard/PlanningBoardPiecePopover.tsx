import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { Dialog } from '../../../components/ui/Dialog';

import type { GrindingPlanningBoardCategory, GrindingPlanningBoardItem } from '@raspi-system/shared-types';

type PieceBlocking = { ready?: boolean; blocked: boolean; message: string; isError: boolean };

export class PieceOperationBlockedError extends Error {
  constructor(message: string, readonly failure = false) { super(message); }
}

type PieceActions = {
  createEnabled: boolean;
  isCutting: (item: GrindingPlanningBoardItem) => boolean;
  enabled: boolean;
  subscribeBlocking: (listener: () => void) => () => void;
  getBlocking: () => PieceBlocking;
  selectedItemsByParent: ReadonlyMap<string, GrindingPlanningBoardItem[]>;
  completionPendingParentIds?: ReadonlySet<string>;
  onSplit: (item: GrindingPlanningBoardItem, quantities: number[]) => Promise<void>;
  onMerge: (items: GrindingPlanningBoardItem[]) => Promise<void>;
  onOpCompletion?: (item: GrindingPlanningBoardItem, intent: 'complete' | 'incomplete', opNo: number) => Promise<void>;
  onRemoved?: (item: GrindingPlanningBoardItem) => void;
};

export const PlanningBoardPiecesContext = createContext<PieceActions | null>(null);

function distributeQuantity(total: number, count: number) {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => base + (index >= count - total % count ? 1 : 0));
}

const EMPTY_SELECTED_PIECES: ReadonlyMap<string, GrindingPlanningBoardItem[]> = new Map();
const PIECE_COLORS = ['bg-sky-400', 'bg-violet-400', 'bg-amber-500', 'bg-pink-400', 'bg-green-400', 'bg-rose-400'];
const PIECE_BORDERS = ['border-t-sky-400', 'border-t-violet-400', 'border-t-amber-500', 'border-t-pink-400', 'border-t-green-400', 'border-t-rose-400'];

export function usePlanningBoardPieceActions({ createEnabled, enabled, resourceCategories, selectedItems, changePieces, completionPendingParentIds, ready = true, blocked = false, blockedMessage = '保存中…', blockedIsError = false, onRemoved, onOpCompletion }: {
  onRemoved?: (item: GrindingPlanningBoardItem) => void;
  onOpCompletion?: PieceActions['onOpCompletion'];
  createEnabled: boolean;
  enabled: boolean;
  resourceCategories: Record<string, GrindingPlanningBoardCategory> | undefined;
  selectedItems: readonly GrindingPlanningBoardItem[];
  completionPendingParentIds?: ReadonlySet<string>;
  ready?: boolean;
  blocked?: boolean;
  blockedMessage?: string;
  blockedIsError?: boolean;
  changePieces: (items: GrindingPlanningBoardItem[], quantities?: number[]) => Promise<void>;
}): PieceActions {
  // Publish readiness to operable controls and blocking to open dialogs, keeping row context stable.
  const blocking = useMemo(() => ({ ready, blocked: blocked || !ready, message: blockedMessage, isError: blockedIsError }),
    [blocked, ready, blockedMessage, blockedIsError]);
  const blockingStore = useRef({ value: blocking, listeners: new Set<() => void>() });
  blockingStore.current.value = blocking;
  useEffect(() => { blockingStore.current.listeners.forEach((listener) => listener()); }, [blocking]);
  const blockingAccess = useMemo(() => ({
    subscribeBlocking: (listener: () => void) => {
      blockingStore.current.listeners.add(listener);
      return () => { blockingStore.current.listeners.delete(listener); };
    },
    getBlocking: () => blockingStore.current.value
  }), []);
  const opCompletionRef = useRef(onOpCompletion);
  opCompletionRef.current = onOpCompletion;
  const changePiecesRef = useRef(changePieces);
  changePiecesRef.current = changePieces;
  const selectedItemsByParent = useMemo(() => {
    const parent = selectedItems[0]?.parentItemId;
    const mergeable = selectedItems.length >= 2 && selectedItems.every((item) => item.kind === 'piece' &&
      item.parentItemId === parent && !item.isLaterProcess && !item.isCompleted && !item.quantityWarning);
    return mergeable && parent
      ? new Map([[parent, [...selectedItems]]])
      : EMPTY_SELECTED_PIECES;
  }, [selectedItems]);
  return useMemo(() => ({
    ...blockingAccess, onRemoved, createEnabled, enabled,
    isCutting: (item: GrindingPlanningBoardItem) => resourceCategories?.[item.originalResourceCd ?? ''] === 'cutting',
    selectedItemsByParent, completionPendingParentIds,
    onOpCompletion: (item: GrindingPlanningBoardItem, intent: 'complete' | 'incomplete', opNo: number) => opCompletionRef.current?.(item, intent, opNo) ?? Promise.resolve(),
    onSplit: (item: GrindingPlanningBoardItem, quantities: number[]) => changePiecesRef.current([item], quantities),
    onMerge: (items: GrindingPlanningBoardItem[]) => changePiecesRef.current(items)
  }), [blockingAccess, onRemoved, createEnabled, enabled, resourceCategories, selectedItemsByParent, completionPendingParentIds]);
}

type PieceFocusTarget = string | { itemId: string; parentItemId: string };

export function usePlanningBoardPieceFocus(items: readonly GrindingPlanningBoardItem[], pending: boolean, refreshSucceeded = true, focusRevision = 0) {
  const itemIdRef = useRef<PieceFocusTarget | null>(null);
  // Dialog restores a surviving trigger itself. A replacement target lasts
  // until its own refresh settles, without taking focus from a new input.
  useEffect(() => {
    if (pending || !itemIdRef.current) return;
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) { itemIdRef.current = null; return; }
    const request = itemIdRef.current;
    if (!refreshSucceeded) return;
    // Consume at the next successful refresh; another input owns any newer focus.
    itemIdRef.current = null;
    if (document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')) return;
    const itemId = typeof request === 'string' ? request : request.itemId;
    const parentItemId = typeof request === 'string' ? null : request.parentItemId;
    const resolved = items.find((item) => item.itemId === itemId) ?? (parentItemId
      ? items.find((item) => item.itemId === parentItemId) ?? items.find((item) => item.parentItemId === parentItemId)
      : undefined);
    if (!resolved && !parentItemId) { itemIdRef.current = null; return; }
    const quantity = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-planning-board-quantity-item]'))
      .find((button) => button.dataset.planningBoardQuantityItem === resolved?.itemId);
    const row = Array.from(document.querySelectorAll<HTMLElement>('[data-planning-board-item-id]'))
      .find((element) => element.dataset.planningBoardItemId === resolved?.itemId);
    const target = quantity && !quantity.disabled ? quantity
      : row?.querySelector<HTMLElement>('button:not([disabled]),input:not([disabled])') ?? row ?? document.querySelector<HTMLElement>('table');
    if (target) {
      if (!target.matches('button,input,[tabindex]')) target.tabIndex = -1;
      target.focus();
      itemIdRef.current = null;
    }
  }, [items, pending, refreshSucceeded, focusRevision]);
  return itemIdRef;
}

export function PlanningBoardPiecePopover({ item, disabled = false, selected = false, specialDueMode, variant = 'table' }: {
  item: GrindingPlanningBoardItem; disabled?: boolean; selected?: boolean; specialDueMode?: 'today' | 'overnight' | null; variant?: 'table' | 'gantt';
}) {
  const actions = useContext(PlanningBoardPiecesContext);
  const [open, setOpen] = useState(false);
  const mergeItems = !item.isLaterProcess && actions?.isCutting(item) && selected && item.kind === 'piece' && item.parentItemId
    ? actions?.selectedItemsByParent.get(item.parentItemId) : undefined;
  const quantity = item.plannedQuantity;
  const canSplit = Boolean(!item.isLaterProcess && actions?.createEnabled && actions.isCutting(item) && item.fseiban?.trim() !== '********' && !item.isCompleted && !item.quantityWarning &&
    typeof quantity === 'number' && Number.isInteger(quantity) && quantity >= 2);
  const canMerge = Boolean(item.kind === 'piece' && mergeItems);
  const label = item.kind === 'piece' ? `${quantity ?? '—'}／${item.parentPlannedQuantity ?? '—'}` : quantity == null ? '—' : `${quantity}個`;
  const canCompleteOp = item.kind === 'piece' && Boolean(item.ops?.length) && item.completionSource !== 'import';
  const operable = !specialDueMode && actions?.enabled && (canSplit || canMerge || canCompleteOp);
  if (variant === 'gantt' && !item.isLaterProcess && !operable && !open) return null;
  if (item.kind !== 'piece' && !operable && !open) return <>{label}</>;
  return <span className={`inline-block min-w-8 align-middle ${variant === 'gantt' ? 'shrink-0 whitespace-nowrap' : ''}`} onClick={operable || open ? (event) => event.stopPropagation() : undefined}>
    {(operable || open) && actions
      ? <PiecePopoverControl variant={variant} item={item} actions={actions} canSplit={canSplit} mergeItems={mergeItems} label={label} disabled={disabled || !operable || actions.completionPendingParentIds?.has(item.parentItemId ?? item.itemId) === true} open={open} setOpen={setOpen} />
      : label}
    {item.kind === 'piece' && <span className="block h-0.5 overflow-hidden rounded bg-slate-700" aria-hidden="true">
      <span className="block h-full bg-emerald-400" style={{ width: `${Math.min(100, Math.max(0, (quantity ?? 0) / (item.parentPlannedQuantity || 1) * 100))}%` }} />
    </span>}
  </span>;
}

type PiecePopoverControlProps = {
  variant: 'table' | 'gantt'; item: GrindingPlanningBoardItem; actions: PieceActions; canSplit: boolean;
  mergeItems?: GrindingPlanningBoardItem[]; label: string; disabled: boolean; open: boolean; setOpen: (open: boolean) => void;
};

function PiecePopoverControl(props: PiecePopoverControlProps) {
  const { item, actions, label, disabled, open, setOpen, variant } = props;
  const ready = useSyncExternalStore(actions.subscribeBlocking, () => actions.getBlocking().ready !== false);
  const operable = !disabled && ready;
  const removalRef = useRef({ item, onRemoved: actions.onRemoved, open });
  removalRef.current = { item, onRemoved: actions.onRemoved, open };
  useEffect(() => () => {
    const current = removalRef.current;
    if (current.open) current.onRemoved?.(current.item);
  }, []);
  return <>
    <button type="button" data-planning-board-quantity-item={item.itemId} disabled={!operable} aria-label={`${item.fhinmei ?? item.fhincd}の数量 ${label}`}
      aria-haspopup="dialog" aria-expanded={open} className={`min-h-11 min-w-11 rounded px-1 tabular-nums disabled:border-transparent ${variant === 'gantt' ? 'border-2 border-sky-400 bg-sky-900' : 'border border-slate-600'}`}
      onClick={() => { setOpen(true); }}>{label}{variant === 'gantt' && <span aria-hidden="true"> ▾</span>}</button>
    {open && <PiecePopoverDialog {...props} disabled={!operable} />}
  </>;
}

function PiecePopoverDialog({ item, actions, canSplit, mergeItems, disabled, open, setOpen }: PiecePopoverControlProps) {
  const quantity = item.plannedQuantity;
  const [showSplit] = useState(canSplit);
  const [quantities, setQuantities] = useState(() => distributeQuantity(quantity ?? 0, 2));
  useEffect(() => {
    if (open && typeof quantity === 'number' && Number.isInteger(quantity) && quantity >= 2) {
      setQuantities((values) => distributeQuantity(quantity, Math.min(values.length, quantity)));
    }
  }, [open, quantity]);
  const count = quantities.length;
  const setCount = (value: number) => setQuantities(distributeQuantity(quantity ?? 0, value));
  const adjust = (index: number, delta: number) => setQuantities((values) => {
    const last = values.length - 1;
    if (index === last || values[index]! + delta < 1 || values[last]! - delta < 1) return values;
    return values.map((value, i) => value + (i === index ? delta : i === last ? -delta : 0));
  });
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; isError: boolean } | null>(null);
  const [backdropReady, setBackdropReady] = useState(false);
  useEffect(() => {
    if (!open) return;
    // Ignore the second tap of the gesture that opened the popup.
    const timer = window.setTimeout(() => setBackdropReady(true), 350);
    return () => window.clearTimeout(timer);
  }, [open]);
  const operable = !disabled;
  const close = () => setOpen(false);
  const validSplit = canSplit && quantities.length >= 2 && quantities.length <= 2000 && quantities.every((value) => Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647) &&
    quantities.reduce((total, value) => total + value, 0) === quantity;
  const run = async (merge: boolean) => {
    if (pending || (merge ? !mergeItems : !canSplit || typeof quantity !== 'number')) return;
    if (!operable || actions.getBlocking().blocked) return;
    if (!merge && !validSplit) return;
    setPending(true);
    setFailure(null);
    try {
      if (merge && mergeItems) await actions.onMerge(mergeItems);
      else if (typeof quantity === 'number') {
        await actions.onSplit(item, quantities);
      }
      setOpen(false);
    } catch (error) {
      if (error instanceof PieceOperationBlockedError && !error.failure) return;
      setFailure({ message: error instanceof Error ? error.message : '保存できませんでした。時間をおいて再試行してください。',
        isError: !(error instanceof PieceOperationBlockedError) || error.failure });
    } finally {
      setPending(false);
    }
  };
  const toggleOp = async (opNo: number, completed: boolean) => {
    if (pending || !backdropReady || !operable || actions.getBlocking().blocked) return;
    setPending(true);
    try { await actions.onOpCompletion?.(item, completed ? 'incomplete' : 'complete', opNo); }
    finally { setPending(false); }
  };
  return <PieceDialog actions={actions} showSplit={showSplit && actions.createEnabled} pending={pending} disabled={!operable} failure={failure} backdropReady={backdropReady} onClose={close}>
      {(blocked) => <div className="flex flex-col gap-2">
        {item.kind === 'piece' && [...(item.ops ?? [])].sort((a, b) => a.opNo - b.opNo).map((op) => {
          const completed = item.completedOpNos?.includes(op.opNo) ?? false;
          return <button key={op.opNo} type="button" aria-label={`工程${op.opNo}を${completed ? '未完了' : '完了'}にする`} aria-pressed={completed}
            disabled={!backdropReady || pending || blocked || !operable} onClick={() => { void toggleOp(op.opNo, completed); }}
            className={`min-h-11 rounded border px-2 text-left tabular-nums disabled:opacity-40 ${completed ? 'border-slate-600 bg-slate-600 text-slate-300' : 'border-sky-400 bg-sky-900'}`}>
            {op.opNo}<span aria-hidden="true" className="float-right">{completed ? '✓' : '○'}</span>
          </button>;
        })}
        {showSplit && actions.createEnabled && <>
          <div role="group" aria-label="分け数" className="grid grid-cols-5 gap-1">
            {[2, 3, 4, 5, 6].map((value) => <button key={value} type="button" aria-label={`${value}つに分ける数`} aria-pressed={count === value}
              disabled={pending || blocked || value > (quantity ?? 0)} onClick={() => setCount(value)}
              className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-2 rounded border-2 tabular-nums disabled:opacity-40 ${count === value ? 'border-emerald-400 text-emerald-400' : 'border-slate-600'}`}>
              <span aria-hidden="true" className="flex h-2 w-[34px] gap-0.5">
                {Array.from({ length: value }, (_, index) => <span key={index} className="min-w-0 flex-1 bg-current" />)}
              </span>
              {value}
            </button>)}
          </div>
          <div aria-hidden="true" className="flex h-3.5 overflow-hidden rounded">
            {quantities.map((value, index) => <span key={index} className={`min-w-0 ${PIECE_COLORS[index % PIECE_COLORS.length]}`} style={{ flex: value }} />)}
          </div>
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(count, 3)}, minmax(0, 1fr))` }}>
            {quantities.map((value, index) => <div key={index} className={`min-w-0 rounded border-t-4 bg-slate-900 py-2 ${PIECE_BORDERS[index % PIECE_BORDERS.length]}`}>
              <output aria-label={`${index + 1}片目の数量`} className="block overflow-x-auto text-center text-xl font-semibold tabular-nums">{value}</output>
              <div className="mt-2 grid grid-cols-2 gap-0.5 px-0.5">
                <button type="button" aria-label={`${index + 1}片目の数量を減らす`} style={{ visibility: index === count - 1 ? 'hidden' : undefined }}
                  disabled={pending || blocked || value <= 1} className="h-9 min-w-0 rounded border border-slate-600 disabled:opacity-40" onClick={() => adjust(index, -1)}>−</button>
                <button type="button" aria-label={`${index + 1}片目の数量を増やす`} style={{ visibility: index === count - 1 ? 'hidden' : undefined }}
                  disabled={pending || blocked || quantities[count - 1]! <= 1} className="h-9 min-w-0 rounded border border-slate-600 disabled:opacity-40" onClick={() => adjust(index, 1)}>＋</button>
              </div>
            </div>)}
          </div>
          <button type="button" disabled={!backdropReady || pending || blocked || !operable || !validSplit} className="min-h-11 rounded border border-emerald-400 disabled:opacity-40" onClick={() => void run(false)}>{count}つに分ける</button>
        </>}
        {mergeItems && <button type="button" disabled={!backdropReady || pending || blocked || !operable} className="min-h-11 rounded border border-emerald-400 disabled:opacity-40" onClick={() => void run(true)}>まとめる</button>}
      </div>}
    </PieceDialog>;
}

function PieceDialog({ actions, showSplit, pending, disabled, failure, backdropReady, onClose, children }: {
  actions: PieceActions; showSplit: boolean; pending: boolean; disabled: boolean;
  failure: { message: string; isError: boolean } | null; backdropReady: boolean;
  onClose: () => void; children: (blocked: boolean) => React.ReactNode;
}) {
  const initialFocusRef = useRef<HTMLDivElement>(null);
  const blocking = useSyncExternalStore(actions.subscribeBlocking, actions.getBlocking);
  const blocked = blocking.blocked || disabled;
  const message = failure ?? (blocked || pending ? { message: blocking.message, isError: blocking.isError } : null);
  return <Dialog isOpen onClose={onClose} closeOnBackdrop={backdropReady} ariaLabel="数量" size="sm" overlayZIndex={100}
    lockScroll={false} initialFocusRef={initialFocusRef} overlayClassName="overscroll-contain"
    className={`${showSplit ? '!max-w-[300px]' : '!max-w-48'} !max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain !bg-slate-950 !text-white ${message?.isError ? '!border-red-500' : ''}`}>
    <div ref={initialFocusRef} tabIndex={-1} className="outline-none" data-planning-board-piece-dialog>{children(blocked)}</div>
    {message && <p role={message.isError ? 'alert' : 'status'} className="mt-2 text-sm">{message.message}</p>}
  </Dialog>;
}
