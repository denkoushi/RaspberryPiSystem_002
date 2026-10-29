import { Button } from '../../../components/ui/Button';

import { addField, removeField, updateField, updateItem } from './editor';

import type { AssemblyCheckSheetItemProposal, AssemblyCheckSheetProposal } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

export const inputKinds = { OK_NG: 'OK / NG', NUMBER: '数値', TEXT: '文字', CHOICE: '選択', NONE: 'なし' } as const;
export const labelClass = 'grid min-w-0 gap-1.5 text-[17px] font-semibold text-slate-400';

export function CheckSheetToggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return <Button type="button" variant="ghostOnDark" aria-pressed={pressed} onClick={onClick}
    className="min-h-[52px] whitespace-nowrap !rounded-xl !border-2 text-xl aria-pressed:border-emerald-500 aria-pressed:bg-emerald-950 aria-pressed:text-white">{children}</Button>;
}

export function CheckSheetItemPanel({ proposal, index, edit, roles }: {
  proposal: AssemblyCheckSheetProposal;
  index: number;
  roles: string[];
  edit: (change: (proposal: AssemblyCheckSheetProposal) => AssemblyCheckSheetProposal) => void;
}) {
  const item = proposal.items[index];
  if (!item) return null;
  const change = (patch: Partial<AssemblyCheckSheetItemProposal>) => edit((current) => updateItem(current, index, patch));
  return <>
    <div className="grid grid-cols-2 gap-3.5">
      <label className={labelClass}>項目番号<input aria-label={`${item.itemKey} 項目番号`} value={item.itemKey} onChange={(e) => change({ itemKey: e.target.value })} /></label>
      <label className={labelClass}>大項目<select aria-label={`${item.itemKey} 大項目`} value={item.groupNo} onChange={(e) => change({ groupNo: Number(e.target.value) })}>
        {proposal.groups.map((group) => <option key={group.groupNo} value={group.groupNo}>{group.groupNo} {group.label}</option>)}
      </select></label>
    </div>
    <label className={labelClass}>大項目名<input aria-label={`${item.itemKey} 大項目名`} value={proposal.groups.find((group) => group.groupNo === item.groupNo)?.label ?? ''}
      onChange={(e) => edit((current) => ({ ...current, groups: current.groups.map((group) => group.groupNo === item.groupNo ? { ...group, label: e.target.value } : group) }))} /></label>
    <label className={labelClass}>文言<textarea aria-label={`${item.itemKey} 文言`} rows={2} value={item.label} onChange={(e) => change({ label: e.target.value })} /></label>
    <div className={labelClass}>入力の種類<div className="grid grid-cols-5 gap-1" role="group" aria-label={`${item.itemKey} 入力の種類`}>
      {Object.entries(inputKinds).map(([kind, label]) => <CheckSheetToggle key={kind} pressed={item.inputKind === kind}
        onClick={() => change({ inputKind: kind as AssemblyCheckSheetItemProposal['inputKind'] })}>{label}</CheckSheetToggle>)}
    </div></div>
    {(item.inputKind === 'NUMBER' || item.inputKind === 'TEXT' || !!item.inputSpec.fields?.length) && <div className={labelClass}>入力欄
      {(item.inputSpec.fields ?? []).map((field) => <div key={field.key} className="grid grid-cols-[minmax(0,1fr)_130px_56px] gap-2.5">
        <input aria-label={`${item.itemKey} ${field.key} ラベル`} value={field.label} onChange={(e) => edit((current) => updateField(current, index, field.key, { label: e.target.value }))} />
        <input aria-label={`${item.itemKey} ${field.key} 単位`} placeholder="単位" value={field.unit ?? ''} onChange={(e) => edit((current) => updateField(current, index, field.key, { unit: e.target.value }))} />
        <Button type="button" variant="ghostOnDark" aria-label={`${item.itemKey} ${field.key} 入力欄を削除`} onClick={() => edit((current) => removeField(current, index, field.key))}>×</Button>
      </div>)}
      <Button type="button" variant="ghostOnDark" className="justify-self-end text-xl" aria-label={`${item.itemKey} 入力欄を追加`} onClick={() => edit((current) => addField(current, index))}>入力欄を追加</Button>
    </div>}
    {item.inputKind === 'CHOICE' && <label className={labelClass}>選択肢<textarea aria-label={`${item.itemKey} 選択肢`} rows={2} value={(item.inputSpec.options ?? []).join('\n')} onChange={(e) => change({ inputSpec: { ...item.inputSpec, options: e.target.value.split('\n') } })} /></label>}
    <div className={labelClass}>担当<div role="group" aria-label={`${item.itemKey} 担当`} className="flex flex-wrap gap-2.5">
      {roles.map((role) => <CheckSheetToggle key={role} pressed={item.roleKeys.includes(role)} onClick={() => change({ roleKeys: item.roleKeys.includes(role) ? item.roleKeys.filter((key) => key !== role) : [...item.roleKeys, role] })}>{role}</CheckSheetToggle>)}
    </div></div>
    <div className="grid grid-cols-3 gap-3.5">
      <label className={labelClass}>押印セル<input aria-label={`${item.itemKey} 押印セル`} value={item.stampCell} onChange={(e) => change({ stampCell: e.target.value.toUpperCase() })} /></label>
      <label className={labelClass}>値のセル<input aria-label={`${item.itemKey} 値セル`} value={item.valueTarget.cell} onChange={(e) => change({ valueTarget: { ...item.valueTarget, cell: e.target.value.toUpperCase() } })} /></label>
      <div className={labelClass}>書き込み<div className="flex gap-1">
        {(['cell', 'inline'] as const).map((mode) => <CheckSheetToggle key={mode} pressed={item.valueTarget.mode === mode} onClick={() => change({ valueTarget: mode === 'cell'
          ? { mode, cell: item.valueTarget.cell }
          : { mode, cell: item.valueTarget.cell, template: item.valueTarget.mode === 'inline' ? item.valueTarget.template : item.label } })}>{mode === 'cell' ? 'セル' : '文中'}</CheckSheetToggle>)}
      </div></div>
    </div>
    {item.valueTarget.mode === 'inline' && <label className={labelClass}>テンプレート<textarea aria-label={`${item.itemKey} テンプレート`} rows={2} value={item.valueTarget.template} onChange={(e) => change({ valueTarget: { mode: 'inline', cell: item.valueTarget.cell, template: e.target.value } })} /></label>}
    <div className="grid grid-cols-2 gap-3.5">
      <label className={labelClass}>条件キー<input aria-label={`${item.itemKey} 条件キー`} value={item.conditionKey ?? ''} onChange={(e) => change({ conditionKey: e.target.value || null })} /></label>
      <label className={labelClass}>条件文<input aria-label={`${item.itemKey} 条件文`} value={item.conditionLabel ?? ''} onChange={(e) => change({ conditionLabel: e.target.value || null })} /></label>
    </div>
  </>;
}
