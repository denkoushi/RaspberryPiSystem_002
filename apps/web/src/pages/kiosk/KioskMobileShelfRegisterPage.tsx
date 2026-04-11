import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import {
  SHELF_AREA_OPTIONS,
  SHELF_LINE_OPTIONS,
  SHELF_SLOT_MAX,
  formatShelfCodeRaw,
  getOccupiedSlotsForCell,
  isCompleteShelfSelection,
  isMobilePlacementShelfRegisterRouteState
} from '../../features/mobile-placement/shelfSelection';

import type { ShelfAreaId, ShelfLineId } from '../../features/mobile-placement/shelfSelection/shelfSelectionTypes';

/**
 * 棚番登録（エリア→列→2桁番号）。確定で配膳ページへ `shelfCode` を router state で返す。
 */
export function KioskMobileShelfRegisterPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = isMobilePlacementShelfRegisterRouteState(location.state)
    ? location.state
    : {
        transferOrder: '',
        transferFhinmei: '',
        actualOrder: '',
        actualFhinmei: '',
        slipResult: 'idle' as const,
        shelfCode: '',
        orderBarcode: ''
      };
  const [areaId, setAreaId] = useState<ShelfAreaId | null>(null);
  const [lineId, setLineId] = useState<ShelfLineId | null>(null);
  const [slot, setSlot] = useState<number | null>(null);

  const previewText = useMemo(() => {
    if (!isCompleteShelfSelection({ areaId: areaId ?? undefined, lineId: lineId ?? undefined, slot: slot ?? undefined })) {
      const parts: string[] = [];
      if (areaId) parts.push(SHELF_AREA_OPTIONS.find((a) => a.id === areaId)!.label);
      if (lineId) parts.push(SHELF_LINE_OPTIONS.find((l) => l.id === lineId)!.label);
      if (slot != null) parts.push(String(slot).padStart(2, '0'));
      return parts.length > 0 ? parts.join('-') : routeState.shelfCode || '—';
    }
    return formatShelfCodeRaw({ areaId: areaId!, lineId: lineId!, slot: slot! });
  }, [areaId, lineId, routeState.shelfCode, slot]);

  const occupied = useMemo(() => {
    if (areaId == null || lineId == null) return new Set<number>();
    return new Set(getOccupiedSlotsForCell(areaId, lineId));
  }, [areaId, lineId]);

  const canConfirm =
    areaId != null &&
    lineId != null &&
    slot != null &&
    !occupied.has(slot) &&
    isCompleteShelfSelection({ areaId, lineId, slot });

  const onBack = () => {
    navigate('/kiosk/mobile-placement', { state: routeState });
  };

  const onConfirm = () => {
    if (!canConfirm || areaId == null || lineId == null || slot == null) return;
    const shelfCode = formatShelfCodeRaw({ areaId, lineId, slot });
    navigate('/kiosk/mobile-placement', { state: { ...routeState, shelfCode } });
  };

  const step2Enabled = areaId != null;
  const step3Enabled = areaId != null && lineId != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-900">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/20 px-3.5 py-3">
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-white/30 bg-white/10 text-lg text-white active:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40"
          title="戻る"
          aria-label="戻る"
          onClick={onBack}
        >
          ←
        </button>
        <h1 className="m-0 text-base font-bold text-white">棚番を登録</h1>
      </header>

      <div className="mx-3.5 mt-3 rounded-[10px] border-2 border-amber-400/80 bg-amber-500/[0.08] px-4 py-3.5 text-center">
        <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-400">選択中の棚番</p>
        <p className="text-[clamp(1.5rem,8vw,2rem)] font-extrabold tabular-nums tracking-wide text-amber-300">
          {previewText}
        </p>
      </div>

      <section
        className="mx-3.5 mt-3.5 rounded-[10px] border-l-[3px] border-l-amber-400 bg-amber-500/[0.04] px-3.5 py-3.5"
        aria-labelledby="step1-heading"
      >
        <p id="step1-heading" className="mb-2.5 flex items-center gap-1.5 text-xs font-bold text-amber-200">
          <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-amber-400/25 text-xs font-extrabold text-amber-50">
            1
          </span>
          エリアを選ぶ
        </p>
        <div className="grid grid-cols-3 gap-2 [grid-template-columns:repeat(3,minmax(0,1fr))]">
          {SHELF_AREA_OPTIONS.map((a) => (
            <Button
              key={a.id}
              type="button"
              variant={areaId === a.id ? 'primary' : 'ghostOnDark'}
              className={
                areaId === a.id
                  ? 'min-h-[52px] min-w-0 !text-white'
                  : 'min-h-[52px] min-w-0 border border-amber-400/35 bg-slate-800 !text-amber-100 active:bg-amber-500/20'
              }
              onClick={() => {
                setAreaId(a.id);
                setLineId(null);
                setSlot(null);
              }}
            >
              {a.label}
            </Button>
          ))}
        </div>
      </section>

      <section
        className={`mx-3.5 mt-3.5 rounded-[10px] border-l-[3px] border-l-amber-400 bg-amber-500/[0.04] px-3.5 py-3.5 ${
          !step2Enabled ? 'pointer-events-none opacity-35' : ''
        }`}
        aria-labelledby="step2-heading"
      >
        <p id="step2-heading" className="mb-2.5 flex items-center gap-1.5 text-xs font-bold text-amber-200">
          <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-amber-400/25 text-xs font-extrabold text-amber-50">
            2
          </span>
          列を選ぶ
        </p>
        <div className="grid grid-cols-3 gap-2 [grid-template-columns:repeat(3,minmax(0,1fr))]">
          {SHELF_LINE_OPTIONS.map((l) => (
            <Button
              key={l.id}
              type="button"
              variant={lineId === l.id ? 'primary' : 'ghostOnDark'}
              disabled={!step2Enabled}
              className={
                lineId === l.id
                  ? 'min-h-[52px] min-w-0 !text-white'
                  : 'min-h-[52px] min-w-0 border border-amber-400/35 bg-slate-800 !text-amber-100 active:bg-amber-500/20'
              }
              onClick={() => {
                setLineId(l.id);
                setSlot(null);
              }}
            >
              {l.label}
            </Button>
          ))}
        </div>
      </section>

      <section
        className={`mx-3.5 mt-3.5 flex min-h-0 flex-1 flex-col rounded-[10px] border-l-[3px] border-l-amber-400 bg-amber-500/[0.04] px-3.5 py-3.5 ${
          !step3Enabled ? 'pointer-events-none opacity-35' : ''
        }`}
        aria-labelledby="step3-heading"
      >
        <p id="step3-heading" className="mb-2.5 flex shrink-0 items-center gap-1.5 text-xs font-bold text-amber-200">
          <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-amber-400/25 text-xs font-extrabold text-amber-50">
            3
          </span>
          空き番号を選ぶ
        </p>
        <div className="grid max-h-[min(50vh,22rem)] min-h-0 grid-cols-5 gap-2 overflow-y-auto [grid-template-columns:repeat(5,minmax(0,1fr))]">
          {Array.from({ length: SHELF_SLOT_MAX }, (_, i) => i + 1).map((n) => {
            const isOcc = occupied.has(n);
            return (
              <Button
                key={n}
                type="button"
                variant={slot === n ? 'primary' : 'ghostOnDark'}
                disabled={!step3Enabled || isOcc}
                className={
                  isOcc
                    ? 'min-h-12 min-w-0 line-through opacity-25'
                    : slot === n
                      ? 'min-h-12 min-w-0 justify-center text-xl font-semibold tabular-nums !text-white'
                      : 'min-h-12 min-w-0 justify-center border border-amber-400/20 bg-slate-800 text-xl font-semibold tabular-nums !text-white'
                }
                onClick={() => setSlot(n)}
              >
                {String(n).padStart(2, '0')}
              </Button>
            );
          })}
        </div>
      </section>

      <div className="mx-3.5 mt-4 shrink-0 pb-4">
        <button
          type="button"
          className="h-[52px] w-full rounded-[10px] border-0 bg-gradient-to-b from-teal-400/50 to-teal-600/35 text-base font-extrabold text-teal-50 disabled:cursor-not-allowed disabled:opacity-30"
          disabled={!canConfirm}
          onClick={onConfirm}
        >
          この棚番で登録
        </button>
      </div>

      <p className="mx-3.5 mb-4 shrink-0 text-center text-[11px] leading-relaxed text-slate-400">
        棚番登録（本番は API から空き番号を取得）。ここではダミーで一部を使用済み表示しています。
      </p>
    </div>
  );
}
