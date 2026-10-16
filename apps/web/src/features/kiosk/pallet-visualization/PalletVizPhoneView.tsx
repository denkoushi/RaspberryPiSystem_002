import { useEffect, useState } from 'react';

import { HaizenHeader } from '../../mobile-placement/haizen/HaizenHeader';
import { HaizenIcon } from '../../mobile-placement/haizen/HaizenIcon';
import { haizenPhoneStyle, hp } from '../../mobile-placement/ui/haizenPhoneTokens';

import type { usePalletVisualizationController } from './usePalletVisualizationController';

type Props = {
  ctrl: ReturnType<typeof usePalletVisualizationController>;
  onBack: () => void;
};

/** Display dates without parsing into a timezone-dependent Date. */
export function phonePalletStartDate(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const match = /^(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})(?:$|T|\s)/.exec(value.trim());
  return match ? `${Number(match[1])}/${Number(match[2])}` : value.trim();
}

export function PalletVizPhoneView({ ctrl, onBack }: Props) {
  const [armed, setArmed] = useState<'clear' | 'delete' | null>(null);
  useEffect(() => {
    setArmed(null);
  }, [ctrl.selectedMachineCd, ctrl.palletNo, ctrl.selectedItemId]);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), 3000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const confirm = (action: 'clear' | 'delete') => {
    if (armed !== action) { setArmed(action); return; }
    setArmed(null);
    if (action === 'clear') {
      ctrl.clearCurrentPallet();
      ctrl.setSelectedItemId(null);
    } else ctrl.deleteSelectedItem();
  };
  const error = ctrl.phoneMutationError || (ctrl.boardQuery.isError ? 'パレットを取得できませんでした' : null);

  return <div style={haizenPhoneStyle} className={hp.screen}>
    <div className={hp.content}>
      <HaizenHeader title="パレット" onBack={onBack} />
      <div role="group" aria-label="加工機" className="flex shrink-0 gap-1.5 overflow-x-auto px-3.5 pb-2 pt-2">
        {ctrl.machines.map((machine) => <button key={machine.machineCd} type="button"
          className={`${hp.chip} !h-10 font-mono !text-sm aria-pressed:!border-[var(--hp-teal)] aria-pressed:bg-[color-mix(in_srgb,var(--hp-panel)_82%,var(--hp-teal))] aria-pressed:!text-[var(--hp-teal)]`}
          aria-pressed={machine.machineCd === ctrl.selectedMachineCd} disabled={ctrl.busy}
          onClick={() => ctrl.selectMachine(machine.machineCd)}>{machine.machineName}</button>)}
      </div>
      <div role="group" aria-label="パレット番号" className="grid max-h-[32dvh] shrink-0 grid-cols-5 gap-1.5 overflow-y-auto px-3.5 pb-2.5">
        {Array.from({ length: ctrl.currentMachine?.palletCount ?? 0 }, (_, i) => {
          const no = i + 1;
          const count = ctrl.currentMachine?.pallets.find((p) => p.palletNo === no)?.items.length ?? 0;
          return <button key={no} type="button" aria-label={`パレット ${no}・${count}件`} aria-pressed={ctrl.palletNo === no}
            disabled={ctrl.busy} onClick={() => ctrl.setPalletNo(no)}
            className="flex h-[62px] flex-col items-center justify-center gap-[3px] rounded-[14px] border border-[var(--hp-line)] bg-[var(--hp-panel)] aria-pressed:border-[var(--hp-teal)] aria-pressed:bg-[color-mix(in_srgb,var(--hp-panel)_70%,var(--hp-teal))]">
            <b className="font-mono text-2xl leading-none tabular-nums">{no}</b>
            <span aria-hidden className="flex h-1.5 gap-[3px]">
              {Array.from({ length: Math.min(count, 3) }, (_, dot) => <i key={dot} className={`h-1.5 w-1.5 rounded-full ${ctrl.palletNo === no ? 'bg-[var(--hp-ink)]' : 'bg-[var(--hp-teal)]'}`} />)}
              {count > 3 && <span className="text-[10px] font-black leading-[6px] text-[var(--hp-teal)]">+{count - 3}</span>}
            </span>
          </button>;
        })}
      </div>
      <div className="flex shrink-0 items-center gap-2.5 border-t border-[var(--hp-line)] px-3.5 pb-2 pt-2.5">
        <span className="font-mono text-[26px] font-bold leading-none text-[var(--hp-teal)]">No.{ctrl.palletNo}</span>
        <span className={`text-[13px] font-bold ${hp.muted}`}>{ctrl.listItems.length}件</span>
        <button type="button" onClick={() => confirm('clear')} disabled={ctrl.busy || !ctrl.listItems.length}
          className={`${hp.mini} ml-auto !h-[34px] !text-[var(--hp-ng)] ${armed === 'clear' ? '!bg-[var(--hp-ng)] !text-[var(--hp-bg)]' : ''}`}>
          {armed === 'clear' ? 'もう一度で全部外す' : '全部外す'}
        </button>
      </div>
      {error && <p role="alert" className="shrink-0 px-3.5 text-sm text-[var(--hp-ng)]">{error}</p>}
      <div data-pallet-viz-item-list-scroll className={`${hp.list} ${hp.hermesBottomPadding}`}>
        {ctrl.listItems.map((item) => {
          const date = phonePalletStartDate(item.plannedStartDateDisplay);
          const meta = [item.fseiban, item.fhincd, date && `着手 ${date}`].filter(Boolean).join(' · ');
          return <button key={item.id} type="button" aria-pressed={ctrl.selectedItemId === item.id} disabled={ctrl.busy}
            onClick={() => ctrl.toggleItemSelection(item.id)}
            className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-[14px] border border-[var(--hp-line)] bg-[var(--hp-panel)] px-3.5 py-2.5 text-left aria-pressed:border-[var(--hp-ink)] aria-pressed:bg-[var(--hp-panel2)]">
            <span className="break-words text-base font-black">{item.fhinmei}</span>
            <span className={`col-start-1 break-words font-mono text-xs ${hp.muted}`}>{meta}</span>
            {item.plannedQuantity != null && Number.isFinite(item.plannedQuantity) && <span className="col-start-2 row-start-1 row-end-3 font-mono text-2xl font-bold text-[var(--hp-teal)]"><small className={`mr-px text-xs ${hp.faint}`}>×</small>{item.plannedQuantity}</span>}
          </button>;
        })}
        {!ctrl.listItems.length && <p className={hp.empty}>{ctrl.boardQuery.isLoading ? '読込中…' : ctrl.currentMachine ? 'まだ載っていません' : '加工機を読み込めません'}</p>}
      </div>
      <footer className={hp.dock}>
        {ctrl.selectedItemId ? <>
          <button type="button" className={`${hp.primary} !h-[58px] !gap-1 !px-2 bg-[var(--hp-teal)] !text-sm`} disabled={ctrl.busy} onClick={() => ctrl.setScanOpen(true)}><HaizenIcon name="scan" className="h-5 w-5" />入れ替え</button>
          <button type="button" className={`${hp.mini} !h-[58px] min-w-0 flex-1 !px-1 !text-[var(--hp-ng)]`} disabled={ctrl.busy} onClick={() => confirm('delete')}>{armed === 'delete' ? 'もう一度で外す' : '外す'}</button>
          <button type="button" className={`${hp.mini} !h-[58px] min-w-0 flex-1 !px-1`} disabled={ctrl.busy} onClick={() => ctrl.setSelectedItemId(null)}>やめる</button>
        </> : <button type="button" className={`${hp.primary} bg-[var(--hp-teal)]`} disabled={ctrl.busy || !ctrl.currentMachine} onClick={() => ctrl.setScanOpen(true)}><HaizenIcon name="scan" />読んで No.{ctrl.palletNo} に載せる</button>}
      </footer>
    </div>
  </div>;
}
