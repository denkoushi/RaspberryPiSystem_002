import { Fragment, useRef, useState } from 'react';

import { saveInventoryMachineOrder, type InventoryMachine } from '../../../api/client';

import { PinIcon } from './InventoryIcons';
import { inventoryMachineLabel } from './inventoryMachineLabel';
import { messageFromError } from './inventoryPageModel';
import { invEyebrow } from './inventoryUi';

// 語の途中では折り返さず、語と語の間で折り返す。1語が枠より長いときだけ語の中で折る。
function machineNameWords(name: string) {
  return name.split(' ').map((word, index) => <Fragment key={index}>{index > 0 ? ' ' : null}<span className="inline-block max-w-full [overflow-wrap:anywhere]">{word}</span></Fragment>);
}

export function InventoryMachinePicker({ machines, selectedId, editing, onEditing, onSelect, nudge, disabled, onError, onOrderSaved }: {
  machines: InventoryMachine[]; selectedId: string | null; editing: boolean; onEditing: (value: boolean) => void;
  onSelect: (id: string) => void; nudge: boolean; disabled: boolean; onError: (message: string) => void; onOrderSaved: (machines: InventoryMachine[]) => void;
}) {
  const [order, setOrder] = useState<InventoryMachine[] | null>(null);
  const machinesKey = JSON.stringify(machines);
  const [orderSource, setOrderSource] = useState(machinesKey);
  if (orderSource !== machinesKey) {
    setOrderSource(machinesKey);
    setOrder(null);
  }
  const [ghost, setGhost] = useState<{ name: string; number?: string; width: number; x: number; y: number; dx: number; dy: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const drag = useRef<{ id: string; before: InventoryMachine[]; order: InventoryMachine[] } | null>(null);
  const shown = order ?? machines;
  const finish = async (cancel = false) => {
    const current = drag.current;
    drag.current = null;
    setDragId(null);
    setGhost(null);
    if (!current) return;
    if (cancel) { setOrder(current.before); return; }
    if (current.before.every((machine, index) => machine.id === current.order[index]?.id)) return;
    setSaving(true);
    try { await saveInventoryMachineOrder(current.order.map(machine => machine.id)); onOrderSaved(current.order); setOrder(null); }
    catch (error) { setOrder(current.before); onError(messageFromError(error)); }
    finally { setSaving(false); }
  };
  return <div className="flex min-h-[124px] flex-1 flex-col">
    <div className="mb-2 flex shrink-0 items-center justify-between">
      <p className={invEyebrow}>使う加工機</p>
      <button type="button" aria-label="並び順を変える" aria-pressed={editing} disabled={disabled || saving || dragId !== null} onClick={() => onEditing(!editing)} className={`flex h-11 w-11 items-center justify-center rounded-xl border ${editing ? 'border-inv-cyan bg-inv-cyan text-inv-cyan-ink' : 'border-inv-line2 bg-transparent text-inv-muted'}`}><PinIcon size={20} /></button>
    </div>
    <div role="group" aria-label="使う加工機" className={`grid min-h-0 flex-1 ${editing ? 'auto-rows-[56px] gap-2' : 'auto-rows-[44px] gap-1.5'} grid-cols-3 content-start overflow-y-auto overscroll-contain rounded-xl ${nudge ? 'outline outline-2 outline-offset-[-2px] outline-inv-amber' : ''}`}
      onPointerMove={event => {
        const current = drag.current;
        if (!current) return;
        setGhost(value => value ? { ...value, x: event.clientX - value.dx, y: event.clientY - value.dy } : null);
        const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-machine-id]')?.dataset.machineId;
        const to = current.order.findIndex(machine => machine.id === over);
        const from = current.order.findIndex(machine => machine.id === current.id);
        if (to < 0 || from === to) return;
        const next = [...current.order];
        next.splice(to, 0, next.splice(from, 1)[0]);
        current.order = next;
        setOrder(next);
      }} onPointerUp={() => void finish()} onPointerCancel={() => void finish(true)} onLostPointerCapture={() => void finish(true)}>
      {shown.map(machine => {
        const label = inventoryMachineLabel(machine, machines);
        return <button key={machine.id} type="button" data-machine-id={machine.id} aria-pressed={!editing && selectedId === machine.id} disabled={disabled || saving}
        onPointerDown={event => {
          if (!editing || disabled || saving || !event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.parentElement!.setPointerCapture(event.pointerId);
          const rect = event.currentTarget.getBoundingClientRect();
          setGhost({ ...label, width: rect.width, x: rect.left, y: rect.top, dx: event.clientX - rect.left, dy: event.clientY - rect.top });
          drag.current = { id: machine.id, before: shown, order: shown };
          setDragId(machine.id);
        }}
        onClick={() => { if (!editing) onSelect(machine.id); }}
        className={`flex min-w-0 items-center justify-center border-[1.5px] px-1.5 text-center font-extrabold ${editing ? 'h-14 rounded-xl text-base leading-tight' : 'h-11 rounded-[10px] text-[15px] leading-[1.1]'} ${editing ? 'touch-none select-none cursor-grab border-dashed border-inv-cyan bg-inv-s1' : selectedId === machine.id ? 'border-inv-cyan bg-inv-cyan text-inv-cyan-ink' : 'border-inv-line2 bg-inv-s2'} ${dragId === machine.id ? 'opacity-40' : ''}`}>
        <span className="line-clamp-2">{machineNameWords(label.name)}{label.number ? <> <span className={`inline-block text-xs ${!editing && selectedId === machine.id ? 'text-inv-cyan-ink' : 'text-inv-muted'}`}>{label.number}</span></> : null}</span>
      </button>; })}
    </div>
    {ghost ? <div aria-hidden="true" className="pointer-events-none fixed z-50 flex h-14 items-center justify-center rounded-xl border-[1.5px] border-inv-cyan bg-inv-s3 px-1.5 text-center text-base font-extrabold leading-tight text-inv-text shadow-xl" style={{ width: ghost.width, left: ghost.x, top: ghost.y }}><span className="line-clamp-2">{machineNameWords(ghost.name)}{ghost.number ? <> <span className="inline-block text-xs text-inv-muted">{ghost.number}</span></> : null}</span></div> : null}
  </div>;
}
