import { getMacroZoneById, type MacroZoneId } from '@raspi-system/shelf-layout-core';
import { useCallback, useEffect, useState } from 'react';

import { HaizenHeader } from '../../haizen/HaizenHeader';
import { HaizenIcon } from '../../haizen/HaizenIcon';
import { HaizenSheet } from '../../haizen/HaizenSheet';
import { hp } from '../../ui/haizenPhoneTokens';
import { useShelfZero2wPreset } from '../hooks/useShelfZero2wPreset';
import { useZoneLayoutDraft } from '../hooks/useZoneLayoutDraft';
import { phoneShelfKinds, phoneShelfTheme as t } from '../theme/phoneShelfMasterTheme';
import { resolveShelfSelectionContext } from '../zero2wPreset/shelfSelectionContext';
import { buildZero2wPiSelectOptions } from '../zero2wPreset/zero2wPiSelectOptions';
import { ZERO2W_PI_CLEAR, ZERO2W_PI_UNCHANGED } from '../zero2wPreset/zero2wPiSelectValue';

import { ShelfPhoneLegend, ShelfPhoneMode, ShelfPhoneZoneGrid } from './ShelfPhoneMap';

import type { MachineMasterDto } from '../../../../api/client';

export function ShelfPhoneLayout({ zoneId, machines, onBack, onOpen, onMode, onMessage }: {
  zoneId: MacroZoneId; machines: MachineMasterDto[]; onBack: () => void;
  onOpen: (zone: MacroZoneId) => void; onMode: (mode: 'photo' | 'relocate' | 'layout') => void; onMessage: (message: string) => void;
}) {
  const draft = useZoneLayoutDraft(zoneId);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'machine' | 'zero' | null>(null);
  const presetMessage = useCallback((message: string | null) => {
    if (!message) return;
    if (message.includes('失敗') || !message.endsWith('しました')) setError(message);
    else onMessage(message);
  }, [onMessage]);
  const preset = useShelfZero2wPreset({ isOpen: true, onMessage: presetMessage });
  const { setMultiMode } = draft;
  useEffect(() => { setMultiMode(true); }, [setMultiMode]);
  const shelfContext = resolveShelfSelectionContext(draft.selectedCells, draft.draftEntities);
  const shelfCode = shelfContext.kind === 'shelf' ? shelfContext.shelfCodeRaw : null;
  const shelfPersisted = !!shelfCode && draft.zoneQuery.data?.entities.some((e) => e.shelfCodeRaw === shelfCode);
  const zeroShelves = new Set(preset.devices.flatMap((d) => d.shelfCodeRaw ? [d.shelfCodeRaw] : []));
  for (const queued of preset.pendingAfterLayoutSave) zeroShelves.add(queued.shelfCodeRaw);
  const busy = draft.savePending || preset.presetApplyPending;
  const unsaved = draft.dirty || preset.hasPendingAfterSave;
  const leave = (action: () => void) => {
    if (busy) return;
    if (unsaved && !window.confirm('未保存の変更を破棄しますか？')) return;
    action();
  };
  const reset = () => {
    if (unsaved && !window.confirm('未保存の変更をリセットしますか？')) return;
    draft.discardDraft(); preset.reset(); setError(null); setSheet(null);
  };
  const save = () => {
    const removesShelf = draft.zoneQuery.data?.entities.some((e) => e.entityKind === 'SHELF' &&
      !draft.draftEntities.some((next) => next.shelfCodeRaw === e.shelfCodeRaw));
    if (removesShelf && !window.confirm('棚を外す変更を保存しますか？')) return;
    setError(null);
    draft.saveLayout(async () => {
      const flushed = await preset.flushPendingPresets(draft.draftEntities.flatMap((e) => e.shelfCodeRaw ? [e.shelfCodeRaw] : []));
      if (!flushed) onMessage('レイアウトを保存しました');
    }, setError);
  };
  const openZero = () => {
    // Existing-preset writes invalidate the layout query. Save edits first to avoid losing the draft.
    if (shelfPersisted && draft.dirty) { setError('先に配置を保存してください'); return; }
    const queued = preset.pendingAfterLayoutSave.find((p) => p.shelfCodeRaw === shelfCode);
    if (queued) preset.setSelectedPi(queued.clientDeviceId);
    else preset.syncPiForShelf(shelfCode);
    setSheet('zero'); setError(null);
  };
  const confirmZero = () => {
    if (!shelfCode) return;
    if (shelfPersisted) preset.applyPresetForExistingShelf(shelfCode);
    else if (preset.selectedPi === ZERO2W_PI_CLEAR) preset.discardPendingPreset(shelfCode);
    else {
      preset.discardPendingPreset(shelfCode);
      preset.queuePresetAfterAssign(shelfCode);
      onMessage('保存時に Zero2W を付けます');
    }
    setSheet(null);
  };

  return <>
    <HaizenHeader title={getMacroZoneById(zoneId).displayName} onBack={() => leave(onBack)} />
    <ShelfPhoneMode mode="layout" canEdit onChange={(mode) => { if (mode !== 'layout') leave(() => onMode(mode)); }} />
    <div className="flex shrink-0 items-center gap-1.5 px-3.5 pb-2">
      {([3, 4] as const).map((size) => <button key={size} type="button" aria-pressed={draft.gridSize === size}
        className={`${hp.mini} aria-pressed:!border-[var(--hp-ink)]`} disabled={busy || !draft.zoneQuery.data}
        onClick={() => draft.handleGridSizeChange(size)}>{size}×{size}</button>)}
      <button type="button" className={`${hp.mini} ml-auto`} disabled={busy || (!unsaved && !draft.selectedCells.length)} onClick={reset}>リセット</button>
    </div>
    {draft.zoneQuery.isLoading ? <p className={hp.empty}>読込中…</p> : draft.zoneQuery.isError ? <p role="alert" className={`${hp.empty} !text-[var(--hp-ng)]`}>配置を取得できませんでした</p>
      : <ShelfPhoneZoneGrid zoneId={zoneId} gridSize={draft.gridSize} entities={draft.draftEntities} selectedCells={draft.selectedCells}
        zeroShelves={zeroShelves} disabled={busy} onOpen={(next) => leave(() => onOpen(next))} onCell={(cells) => { setError(null); draft.toggleCell(cells); }} />}
    <div className={t.dock}>
      {error && <p role="alert" className="text-xs text-[var(--hp-ng)]">{error}</p>}
      {draft.selectedCells.length ? <>
        <div className="grid grid-cols-4 gap-1.5">
          {phoneShelfKinds.map(([kind, label]) => <button key={kind} type="button" disabled={busy}
            className="flex h-[54px] flex-col items-center justify-center gap-1 rounded-xl border border-[var(--hp-line)] bg-[var(--hp-panel)] text-sm font-black"
            onClick={() => {
              setError(null);
              if (kind === 'MACHINE') { setSheet('machine'); draft.setSelectedMachineCd(''); }
              else draft.handleAssign(machines, setError, { kind });
            }}><i aria-hidden className={`h-2.5 w-4 rounded-[3px] ${t.swatch[kind]}`} />{label}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={`${hp.mini} !h-11`} disabled={busy} onClick={draft.handleDeselectOnly}>選択をやめる {draft.selectedCells.length}</button>
          {shelfCode && <button type="button" className={`${hp.mini} !h-11 !text-[var(--hp-slip)]`} disabled={busy} onClick={openZero}>Zero2W {zeroShelves.has(shelfCode) ? '外す' : '付ける'}</button>}
        </div>
      </> : <div className={t.status}><span className="h-2.5 w-2.5 rounded-full bg-[var(--hp-ink3)]" />変える区画をタップ（複数可）</div>}
      {draft.dirty ? <div className="flex"><button type="button" className={`${hp.primary} !h-[52px] bg-[var(--hp-ok)] !text-base`} disabled={busy} onClick={save}><HaizenIcon name="check" className="h-5 w-5" />{busy ? '保存中…' : '保存'}</button></div> : <ShelfPhoneLegend />}
    </div>
    {sheet === 'machine' && <HaizenSheet title="加工機を選ぶ" onClose={() => setSheet(null)}>
      <div className="flex items-center justify-between"><h2 className="font-black">加工機を選ぶ</h2><button type="button" className={hp.mini} onClick={() => setSheet(null)}>やめる</button></div>
      <div className="flex max-h-[45dvh] flex-col gap-2 overflow-y-auto">
        {machines.map((machine) => <button key={machine.resourceCd} type="button" className={`${hp.segment} self-start`} aria-pressed={draft.selectedMachineCd === machine.resourceCd}
          onClick={() => draft.setSelectedMachineCd(machine.resourceCd)}>{machine.resourceName}</button>)}
        {!machines.length && <p className={hp.muted}>加工機を取得できませんでした</p>}
      </div>
      <button type="button" className={`${hp.mini} self-end !text-[var(--hp-teal)]`} disabled={!draft.selectedMachineCd} onClick={() => {
        draft.handleAssign(machines, setError, { kind: 'MACHINE', machineCd: draft.selectedMachineCd }); setSheet(null);
      }}>確定</button>
    </HaizenSheet>}
    {sheet === 'zero' && shelfCode && <HaizenSheet title="Zero2W 担当棚" onClose={() => setSheet(null)}>
      <div className="flex items-center justify-between"><h2 className="font-black">Zero2W · {shelfCode}</h2><button type="button" className={hp.mini} onClick={() => setSheet(null)}>やめる</button></div>
      <div className="flex max-h-[45dvh] flex-col gap-2 overflow-y-auto">
        {buildZero2wPiSelectOptions(preset.devices, shelfCode).filter((option) => option.value !== ZERO2W_PI_UNCHANGED).map((option) => <button key={option.value} type="button"
          disabled={option.disabled || (option.value === ZERO2W_PI_CLEAR && !zeroShelves.has(shelfCode))}
          aria-pressed={preset.selectedPi === option.value} className={`${hp.segment} self-start disabled:opacity-40`} onClick={() => preset.setSelectedPi(option.value)}>
          {option.value === ZERO2W_PI_CLEAR ? 'Zero2W 外す' : option.label}{option.subLabel && <small className="ml-2">{option.subLabel}</small>}
        </button>)}
        {preset.devicesQuery.isError && <p role="alert" className="text-sm text-[var(--hp-ng)]">Zero2W を取得できませんでした</p>}
      </div>
      <button type="button" className={`${hp.mini} self-end !text-[var(--hp-slip)]`} disabled={busy || (!preset.piSelectionNeedsApply(shelfCode) && !(preset.selectedPi === ZERO2W_PI_CLEAR && zeroShelves.has(shelfCode)))} onClick={confirmZero}>確定</button>
    </HaizenSheet>}
  </>;
}
