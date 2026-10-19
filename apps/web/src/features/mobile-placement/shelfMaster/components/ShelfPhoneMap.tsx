import { getMacroZoneById, MACRO_ZONE_CATALOG } from '@raspi-system/shelf-layout-core';

import { buildRenderItems } from '../model/shelfLayoutGrid';
import { buildZoneOverviewCells } from '../model/zoneOverviewCells';
import { phoneShelfKinds, phoneShelfTheme as t } from '../theme/phoneShelfMasterTheme';

import type { ShelfLayoutSummaryDto } from '../../../../api/client';
import type { DraftEntity } from '../model/shelfLayoutTypes';
import type { MacroZoneId } from '@raspi-system/shelf-layout-core';

// The existing catalog uses area as factoryRow. The phone map is north-up.
export const phoneZones = [...MACRO_ZONE_CATALOG].sort((a, b) => a.factoryCol - b.factoryCol || a.factoryRow - b.factoryRow);
export function phoneNeighbor(zoneId: MacroZoneId, direction: 'n' | 's' | 'w' | 'e'): MacroZoneId | null {
  const zone = getMacroZoneById(zoneId);
  const row = zone.factoryCol + (direction === 'n' ? -1 : direction === 's' ? 1 : 0);
  const col = zone.factoryRow + (direction === 'w' ? -1 : direction === 'e' ? 1 : 0);
  return phoneZones.find((z) => z.factoryCol === row && z.factoryRow === col)?.id ?? null;
}

function ZeroDot() {
  return <span role="img" aria-label="Zero2W 担当" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--hp-slip)] ring-2 ring-[var(--hp-panel)]" />;
}

export function ShelfPhoneLegend() {
  return <div className="flex flex-wrap justify-center gap-x-2 gap-y-1 text-[11px] font-bold text-[var(--hp-ink3)]">
    {phoneShelfKinds.map(([kind, label]) => <span key={kind} className="flex items-center gap-1"><i aria-hidden className={`h-2.5 w-2.5 rounded-[3px] ${t.swatch[kind]}`} />{label}</span>)}
    <span className="flex items-center gap-1"><i aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--hp-slip)]" />Zero2W</span>
  </div>;
}

export function ShelfPhoneMap({ zones, zeroShelves, onOpen }: {
  zones: ShelfLayoutSummaryDto[]; zeroShelves: Set<string>; onOpen: (zone: MacroZoneId) => void;
}) {
  return <>
    <div className="flex shrink-0 justify-between px-[18px] pb-1 text-[11px] font-black tracking-widest text-[var(--hp-ink3)]"><span>西</span><span>中央</span><span>東</span></div>
    <div aria-label="工場マップ" className="grid min-h-0 flex-1 grid-cols-3 grid-rows-3 gap-2 px-3.5 pb-1.5">
      {phoneZones.map((zone) => {
        const data = zones.find((z) => z.macroZoneId === zone.id);
        return <button key={zone.id} type="button" onClick={() => onOpen(zone.id)}
          className="flex min-h-0 min-w-0 flex-col gap-[7px] rounded-[14px] border border-[var(--hp-line)] bg-[var(--hp-panel)] p-[9px] text-left">
          <span className="flex flex-wrap items-baseline justify-between gap-x-1 text-sm font-black">{zone.displayName}{data && <small className="whitespace-nowrap text-[11px] font-bold text-[var(--hp-ink3)]">棚{data.shelfCount}</small>}</span>
          {data && <span aria-hidden className="grid min-h-0 w-full flex-1 gap-[3px]" style={{ gridTemplateColumns: `repeat(${data.gridSize}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${data.gridSize}, minmax(0, 1fr))` }}>
            {buildZoneOverviewCells(data.entities, data.gridSize).map(({ entity }, index) => <span key={index} className={`relative rounded-[3px] ${t.swatch[entity?.entityKind ?? 'UNUSED']}`}>
              {entity?.shelfCodeRaw && zeroShelves.has(entity.shelfCodeRaw) && <ZeroDot />}
            </span>)}
          </span>}
        </button>;
      })}
    </div>
  </>;
}

export function ShelfPhoneZoneGrid({ zoneId, gridSize, entities, selectedCells = [], source, zeroShelves, disabled, onOpen, onCell }: {
  zoneId: MacroZoneId; gridSize: 3 | 4; entities: DraftEntity[]; selectedCells?: number[];
  source?: string | null; zeroShelves: Set<string>; disabled: boolean;
  onOpen: (zone: MacroZoneId) => void; onCell: (cells: number[]) => void;
}) {
  return <div aria-label="区画の配置" className="grid min-h-0 flex-1 gap-1.5 px-2.5 pb-1.5"
    style={{ gridTemplateColumns: `30px repeat(${gridSize}, minmax(0, 1fr)) 30px`, gridTemplateRows: `30px repeat(${gridSize}, minmax(0, 1fr)) 30px` }}>
    {(['n', 's', 'w', 'e'] as const).map((dir) => {
      const next = phoneNeighbor(zoneId, dir);
      if (!next) return null;
      const vertical = dir === 'w' || dir === 'e';
      return <button key={dir} type="button" disabled={disabled} onClick={() => onOpen(next)} className={t.edge}
        style={{ gridColumn: vertical ? (dir === 'w' ? 1 : gridSize + 2) : `2 / ${gridSize + 2}`, gridRow: vertical ? `2 / ${gridSize + 2}` : (dir === 'n' ? 1 : gridSize + 2) }}>
        <span className={vertical ? 'flex flex-col items-center gap-1' : 'flex items-center gap-1'}><span aria-hidden>{{ n: '↑', s: '↓', w: '←', e: '→' }[dir]}</span><span style={vertical ? { writingMode: 'vertical-rl' } : undefined}>{getMacroZoneById(next).displayName}</span></span>
      </button>;
    })}
    {buildRenderItems(entities, gridSize).map((item) => {
      const entity = item.entity;
      const kind = entity?.entityKind ?? 'UNUSED';
      const selected = item.cells.some((c) => selectedCells.includes(c));
      const from = !!source && entity?.shelfCodeRaw === source;
      const target = !!source && kind === 'SHELF' && !from;
      const code = entity?.shelfCodeRaw;
      const number = code?.split('-').at(-1);
      return <button key={item.cells.join('-')} type="button" aria-pressed={selected || from}
        aria-label={code ?? (kind === 'MACHINE' ? `加工機 ${entity?.resourceName ?? ''}` : `${kind === 'AISLE' ? '通路' : '空き'} ${item.cells[0] + 1}`)}
        disabled={disabled} onClick={() => onCell(item.cells)}
        className={`${t.cell} ${t.kind[kind]} ${selected ? 'outline outline-[3px] outline-offset-2 outline-[var(--hp-ink)]' : ''} ${from ? 'outline outline-[3px] outline-offset-2 outline-[var(--hp-shelf)]' : ''} ${target ? '!border-[var(--hp-ok)]' : ''}`}
        style={{ gridColumn: `${item.minC + 2} / ${item.maxC + 3}`, gridRow: `${item.minR + 2} / ${item.maxR + 3}` }}>
        {kind === 'SHELF' ? <><span className="max-w-full truncate px-1 text-[10px] font-bold text-[var(--hp-ink3)]">{code?.slice(0, code.lastIndexOf('-'))}</span><span className="font-mono text-[26px] leading-none tabular-nums">{number ?? '棚'}</span>{target && <span className="text-[11px] text-[var(--hp-ok)]">ここへ</span>}</>
          : kind === 'MACHINE' ? <><span className="text-[10px] text-[var(--hp-teal)]">加工機</span><span className="max-w-full break-all px-1 font-mono text-xs">{entity?.resourceName}</span></>
            : <span className="text-[11px]">{kind === 'AISLE' ? '通路' : '空き'}</span>}
        {code && zeroShelves.has(code) && <ZeroDot />}
      </button>;
    })}
  </div>;
}

export function ShelfPhoneMode({ mode, canEdit, onChange }: {
  mode: 'relocate' | 'layout'; canEdit: boolean; onChange: (mode: 'relocate' | 'layout') => void;
}) {
  return <div className="shrink-0 px-3.5 pb-2 pt-2"><div className="inline-flex overflow-hidden rounded-xl border border-[var(--hp-line)]">
    {(['relocate', 'layout'] as const).filter((m) => m !== 'layout' || canEdit).map((m) => <button key={m} type="button" aria-pressed={mode === m}
      className="h-10 px-3.5 text-sm font-black text-[var(--hp-ink3)] aria-pressed:bg-[var(--hp-ink)] aria-pressed:text-[var(--hp-bg)]" onClick={() => onChange(m)}>{m === 'relocate' ? '棚を移す' : '配置を変える'}</button>)}
  </div></div>;
}

