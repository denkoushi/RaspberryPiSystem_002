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
  onRemoved?: (item: GrindingPlanningBoardItem) => void;
};

export const PlanningBoardPiecesContext = createContext<PieceActions | null>(null);

const EMPTY_SELECTED_PIECES: ReadonlyMap<string, GrindingPlanningBoardItem[]> = new Map();

export function usePlanningBoardPieceActions({ createEnabled, enabled, resourceCategories, selectedItems, changePieces, completionPendingParentIds, ready = true, blocked = false, blockedMessage = '保存中…', blockedIsError = false, onRemoved }: {
  onRemoved?: (item: GrindingPlanningBoardItem) => void;
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
  const changePiecesRef = useRef(changePieces);
  changePiecesRef.current = changePieces;
  const selectedItemsByParent = useMemo(() => {
    const parent = selectedItems[0]?.parentItemId;
    const mergeable = selectedItems.length >= 2 && selectedItems.every((item) => item.kind === 'piece' &&
      item.parentItemId === parent && !item.isCompleted && !item.quantityWarning);
    return mergeable && parent
      ? new Map([[parent, [...selectedItems]]])
      : EMPTY_SELECTED_PIECES;
  }, [selectedItems]);
  return useMemo(() => ({
    ...blockingAccess, onRemoved, createEnabled, enabled,
    isCutting: (item: GrindingPlanningBoardItem) => resourceCategories?.[item.originalResourceCd ?? ''] === 'cutting',
    selectedItemsByParent, completionPendingParentIds,
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

export function PlanningBoardPiecePopover({ item, disabled = false, selected = false, specialDueMode }: {
  item: GrindingPlanningBoardItem; disabled?: boolean; selected?: boolean; specialDueMode?: 'today' | 'overnight' | null;
}) {
  const actions = useContext(PlanningBoardPiecesContext);
  const [open, setOpen] = useState(false);
  const mergeItems = selected && item.kind === 'piece' && item.parentItemId
    ? actions?.selectedItemsByParent.get(item.parentItemId) : undefined;
  const quantity = item.plannedQuantity;
  const canSplit = Boolean(actions?.createEnabled && actions.isCutting(item) && item.fseiban?.trim() !== '********' && !item.isCompleted && !item.quantityWarning &&
    typeof quantity === 'number' && Number.isInteger(quantity) && quantity >= 2);
  const canMerge = Boolean(item.kind === 'piece' && mergeItems);
  const label = item.kind === 'piece' ? `${quantity ?? '—'}／${item.parentPlannedQuantity ?? '—'}` : quantity == null ? '—' : `${quantity}個`;
  const operable = !specialDueMode && actions?.enabled && (canSplit || canMerge);
  if (item.kind !== 'piece' && !operable && !open) return <>{label}</>;
  return <span className="inline-block min-w-8 align-middle" onClick={operable || open ? (event) => event.stopPropagation() : undefined}>
    {(operable || open) && actions
      ? <PiecePopoverControl item={item} actions={actions} canSplit={canSplit} mergeItems={mergeItems} label={label} disabled={disabled || !operable} open={open} setOpen={setOpen} />
      : label}
    {item.kind === 'piece' && <span className="block h-0.5 overflow-hidden rounded bg-slate-700" aria-hidden="true">
      <span className="block h-full bg-emerald-400" style={{ width: `${Math.min(100, Math.max(0, (quantity ?? 0) / (item.parentPlannedQuantity || 1) * 100))}%` }} />
    </span>}
  </span>;
}

function PiecePopoverControl({ item, actions, canSplit, mergeItems, label, disabled, open, setOpen }: {
  item: GrindingPlanningBoardItem; actions: PieceActions; canSplit: boolean;
  mergeItems?: GrindingPlanningBoardItem[]; label: string; disabled: boolean; open: boolean; setOpen: (open: boolean) => void;
}) {
  const [count, setCount] = useState(2);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; isError: boolean } | null>(null);
  const [backdropReady, setBackdropReady] = useState(false);
  useEffect(() => {
    if (!open) return;
    // Ignore the second tap of the gesture that opened the popup.
    const timer = window.setTimeout(() => setBackdropReady(true), 350);
    return () => window.clearTimeout(timer);
  }, [open]);
  const removalRef = useRef({ item, onRemoved: actions.onRemoved, open });
  removalRef.current = { item, onRemoved: actions.onRemoved, open };
  useEffect(() => () => {
    const current = removalRef.current;
    if (current.open) current.onRemoved?.(current.item);
  }, []);
  const quantity = item.plannedQuantity;
  const ready = useSyncExternalStore(actions.subscribeBlocking, () => actions.getBlocking().ready !== false);
  const operable = !disabled && ready;
  const close = () => setOpen(false);
  const run = async (merge: boolean) => {
    if (pending || (merge ? !mergeItems : !canSplit || typeof quantity !== 'number')) return;
    setPending(true);
    setFailure(null);
    try {
      if (merge && mergeItems) await actions.onMerge(mergeItems);
      else if (typeof quantity === 'number') {
        const n = Math.min(count, quantity);
        const base = Math.floor(quantity / n);
        const remainder = quantity % n;
        await actions.onSplit(item, Array.from({ length: n }, (_, index) => base + (index >= n - remainder ? 1 : 0)));
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
  return <>
    <button type="button" data-planning-board-quantity-item={item.itemId} disabled={!operable} aria-label={`${item.fhinmei ?? item.fhincd}の数量 ${label}`}
      aria-haspopup="dialog" aria-expanded={open} className="min-h-11 min-w-11 rounded border border-slate-600 px-1 tabular-nums disabled:border-transparent"
      onClick={() => { setCount(2); setFailure(null); setBackdropReady(false); setOpen(true); }}>{label}</button>
    {open && <PieceDialog actions={actions} pending={pending} disabled={!operable} failure={failure} backdropReady={backdropReady} onClose={close}>
      {(blocked) => <div className="flex flex-col gap-2">
        {canSplit && <>
          <div className="flex items-center justify-between gap-2">
            <button type="button" aria-label="分け数を減らす" disabled={!backdropReady || count <= 2} className="h-11 w-11 rounded border disabled:opacity-40" onClick={() => setCount((value) => value - 1)}>−</button>
            <output aria-label="分け数" className="tabular-nums">{Math.min(count, quantity ?? 0)}</output>
            <button type="button" aria-label="分け数を増やす" disabled={!backdropReady || count >= (quantity ?? 0)} className="h-11 w-11 rounded border disabled:opacity-40" onClick={() => setCount((value) => value + 1)}>＋</button>
          </div>
          <button type="button" disabled={!backdropReady || pending || blocked || !operable} className="min-h-11 rounded border border-emerald-400 disabled:opacity-40" onClick={() => void run(false)}>分ける</button>
        </>}
        {mergeItems && <button type="button" disabled={!backdropReady || pending || blocked || !operable} className="min-h-11 rounded border border-emerald-400 disabled:opacity-40" onClick={() => void run(true)}>まとめる</button>}
      </div>}
    </PieceDialog>}
  </>;
}

function PieceDialog({ actions, pending, disabled, failure, backdropReady, onClose, children }: {
  actions: PieceActions; pending: boolean; disabled: boolean;
  failure: { message: string; isError: boolean } | null; backdropReady: boolean;
  onClose: () => void; children: (blocked: boolean) => React.ReactNode;
}) {
  const initialFocusRef = useRef<HTMLDivElement>(null);
  const blocking = useSyncExternalStore(actions.subscribeBlocking, actions.getBlocking);
  const blocked = blocking.blocked || disabled;
  const message = failure ?? (blocked || pending ? { message: blocking.message, isError: blocking.isError } : null);
  return <Dialog isOpen onClose={onClose} closeOnBackdrop={backdropReady} ariaLabel="数量" size="sm" overlayZIndex={100}
    lockScroll={false} initialFocusRef={initialFocusRef} overlayClassName="overscroll-contain"
    className={`!max-w-48 !bg-slate-950 !text-white ${message?.isError ? '!border-red-500' : ''}`}>
    <div ref={initialFocusRef} tabIndex={-1} className="outline-none" data-planning-board-piece-dialog>{children(blocked)}</div>
    {message && <p role={message.isError ? 'alert' : 'status'} className="mt-2 text-sm">{message.message}</p>}
  </Dialog>;
}
