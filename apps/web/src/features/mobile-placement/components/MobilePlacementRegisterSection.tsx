import clsx from 'clsx';
import { useMemo, useState } from 'react';

import { MP_PLACEHOLDER_ORDER } from '../constants';
import { ViewfinderIcon } from '../icons/ViewfinderIcon';
import {
  filterStructuredShelvesByAreaLine,
  listUnstructuredShelves,
  type RegisteredShelfEntryDto
} from '../registeredShelves';
import { SHELF_AREA_OPTIONS, SHELF_LINE_OPTIONS } from '../shelfSelection/defaultShelfRegisterCatalog';

import { IconScanButton } from './IconScanButton';

import type { ShelfAreaId, ShelfLineId } from '../shelfSelection/shelfSelectionTypes';


export type MobilePlacementRegisterSectionProps = {
  shelfCode: string;
  onSelectShelf: (code: string) => void;
  onOpenShelfRegister: () => void;
  onShelfQrScan: () => void;
  registeredShelves: RegisteredShelfEntryDto[];
  registeredShelvesLoading: boolean;
  registeredShelvesError: boolean;
  onRetryRegisteredShelves: () => void;
  orderBarcode: string;
  onOrderBarcodeChange: (v: string) => void;
  onOrderScan: () => void;
  registerSubmitting: boolean;
  registerDisabled: boolean;
  onRegister: () => void;
  registerMessage: string | null;
  registerError: string | null;
};

/**
 * 下半: 登録済み棚番（絞り込み）+ QR + 新規登録 + 製造order・登録
 */
export function MobilePlacementRegisterSection(props: MobilePlacementRegisterSectionProps) {
  const [areaId, setAreaId] = useState<ShelfAreaId | null>(null);
  const [lineId, setLineId] = useState<ShelfLineId | null>(null);

  const unstructured = useMemo(
    () => listUnstructuredShelves(props.registeredShelves),
    [props.registeredShelves]
  );

  const filteredStructured = useMemo(() => {
    if (!areaId || !lineId) return [];
    const list = filterStructuredShelvesByAreaLine(props.registeredShelves, areaId, lineId);
    return [...list].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  }, [props.registeredShelves, areaId, lineId]);

  const filterReady = areaId !== null && lineId !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
      <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-[10px] border-l-[3px] border-l-amber-400 bg-amber-500/[0.06] px-2.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[13px] font-extrabold text-amber-200">登録済みの棚番</div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border-0 bg-transparent px-1.5 py-1 text-[10px] font-bold text-sky-300 active:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40"
            title="棚のQRコードをスキャンして棚番を入力"
            aria-label="棚をQRスキャン"
            onClick={props.onShelfQrScan}
          >
            <ViewfinderIcon className="h-[18px] w-[18px] text-sky-300" />
            <span>QR</span>
          </button>
          <div className="text-[10px] text-slate-400">
            選択中{' '}
            <strong className="block max-w-[8rem] break-all text-[12px] font-extrabold text-amber-100">
              {props.shelfCode || '—'}
            </strong>
          </div>
          <button
            type="button"
            className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-amber-400/30 bg-slate-950/80 text-xl font-light leading-none text-amber-200 active:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
            title="棚番を新規登録（エリア→列→番号）"
            aria-label="棚番を新規登録"
            onClick={props.onOpenShelfRegister}
          >
            +
          </button>
        </div>

        <div className="grid grid-cols-6 gap-1">
          {SHELF_AREA_OPTIONS.map((o) => (
            <button
              key={`a-${o.id}`}
              type="button"
              className={clsx(
                'min-h-11 rounded-lg border px-0.5 text-[11px] font-extrabold active:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40',
                areaId === o.id
                  ? 'border-emerald-500 bg-emerald-500/20 text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]'
                  : 'border-amber-400/35 bg-slate-800 text-amber-100'
              )}
              onClick={() => setAreaId(o.id)}
            >
              {o.label}
            </button>
          ))}
          {SHELF_LINE_OPTIONS.map((o, i) => (
            <button
              key={`l-${o.id}`}
              type="button"
              className={clsx(
                'min-h-11 rounded-lg border px-0.5 text-[11px] font-extrabold active:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40',
                i === 0 ? 'border-l border-l-amber-400/25 pl-0.5' : '',
                lineId === o.id
                  ? 'border-emerald-500 bg-emerald-500/20 text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]'
                  : 'border-amber-400/35 bg-slate-800 text-amber-100'
              )}
              onClick={() => setLineId(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="flex justify-end text-[10px] font-bold text-slate-500 tabular-nums">
          {filterReady && !props.registeredShelvesLoading
            ? `表示 ${filteredStructured.length}件`
            : ''}
        </div>

        <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-amber-400/15 bg-slate-950/50 p-2">
          {props.registeredShelvesLoading ? (
            <div className="flex min-h-[8rem] flex-1 flex-col items-center justify-center text-sm text-slate-500">
              登録済み棚を読み込み中…
            </div>
          ) : props.registeredShelvesError ? (
            <div className="flex min-h-[8rem] flex-1 flex-col items-center justify-center gap-2 px-2 text-center">
              <p className="text-sm text-red-200">登録済み棚の取得に失敗しました</p>
              <button
                type="button"
                className="rounded-md border border-amber-400/40 px-3 py-1.5 text-xs font-bold text-amber-100 active:bg-amber-500/15"
                onClick={props.onRetryRegisteredShelves}
              >
                再試行
              </button>
            </div>
          ) : !filterReady ? (
            <div className="flex min-h-[8rem] flex-1 flex-col items-center justify-center px-2 text-center text-sm text-slate-500">
              エリアと列の両方をタップすると、該当する登録棚が表示されます。
            </div>
          ) : (
            <>
              {filteredStructured.length === 0 ? (
                <p className="mb-2 text-center text-xs text-slate-500">この組み合わせの登録棚はありません</p>
              ) : (
                <div className="grid max-h-[min(40vh,240px)] grid-cols-4 gap-1.5 overflow-y-auto">
                  {filteredStructured.map((s) => (
                    <button
                      key={s.shelfCodeRaw}
                      type="button"
                      className={clsx(
                        'min-h-11 rounded-lg border px-0.5 text-[11px] font-extrabold tabular-nums active:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40',
                        props.shelfCode === s.shelfCodeRaw
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]'
                          : 'border-amber-400/35 bg-slate-800 text-amber-100'
                      )}
                      onClick={() => props.onSelectShelf(s.shelfCodeRaw)}
                    >
                      {s.shelfCodeRaw}
                    </button>
                  ))}
                </div>
              )}
              {unstructured.length > 0 ? (
                <div className="mt-2 border-t border-dashed border-white/15 pt-2">
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">その他の登録棚</p>
                  <div className="flex flex-wrap gap-1.5">
                    {unstructured.map((s) => (
                      <button
                        key={s.shelfCodeRaw}
                        type="button"
                        className={clsx(
                          'min-h-9 rounded-md border px-2 text-xs font-bold active:bg-amber-500/15',
                          props.shelfCode === s.shelfCodeRaw
                            ? 'border-emerald-500 bg-emerald-500/15 text-emerald-100'
                            : 'border-amber-400/30 bg-slate-800/80 text-slate-200'
                        )}
                        onClick={() => props.onSelectShelf(s.shelfCodeRaw)}
                      >
                        {s.shelfCodeRaw}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="rounded-[10px] border-l-[3px] border-l-teal-400 bg-teal-500/[0.06] px-2.5 py-2.5">
        <div className="flex w-full min-w-0 flex-nowrap items-center gap-1.5">
          <label className="sr-only" htmlFor="mp-order-scan">
            {MP_PLACEHOLDER_ORDER}
          </label>
          <div className="w-[calc((100%-10px)/2-46px)] min-w-0 max-w-full shrink-0">
            <input
              id="mp-order-scan"
              value={props.orderBarcode}
              onChange={(e) => props.onOrderBarcodeChange(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder={MP_PLACEHOLDER_ORDER}
              className="h-10 w-full rounded-md border border-teal-400/30 bg-slate-950 px-2.5 text-sm text-white tabular-nums placeholder:text-slate-400"
            />
          </div>
          <IconScanButton variant="order" title="スキャン" aria-label="製造orderをスキャン" onClick={props.onOrderScan} />
          <button
            type="button"
            className="h-10 shrink-0 rounded-md border border-teal-400/55 bg-gradient-to-b from-teal-400/40 to-teal-600/25 px-4 text-sm font-bold text-teal-100 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={props.registerDisabled}
            onClick={props.onRegister}
          >
            {props.registerSubmitting ? '登録中…' : '登録'}
          </button>
        </div>
      </div>

      {props.registerMessage ? (
        <p className="text-sm text-emerald-200" role="status">
          {props.registerMessage}
        </p>
      ) : null}
      {props.registerError ? (
        <p className="text-sm text-red-200" role="alert">
          {props.registerError}
        </p>
      ) : null}

      <p className="text-center text-[11px] text-slate-400">照合OK → 棚 → 製造order → 登録</p>
    </div>
  );
}
