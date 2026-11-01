import { familyName, roleLabel, stampInput, stampTime } from './checkSheetState';

import type { CheckDraft, CheckItem, CheckStamp } from './checkSheetState';

export function CheckSheetSeal({ stamp }: { stamp: CheckStamp }) {
  return <div className={`seal ${stamp.result === 'NG' ? 'ng' : stamp.result === 'NA' ? 'na' : ''}`}><div>
    {stamp.positionNameSnapshot && stamp.result !== 'NA' && <div className="rl">{stamp.positionNameSnapshot}</div>}
    <div className="nm">{stamp.result === 'NA' ? '該当なし' : familyName(stamp.employeeNameSnapshot)}</div>
    <div className="tm num">{stamp.result === 'NA' ? `${familyName(stamp.employeeNameSnapshot)} ` : ''}{stampTime(stamp)}</div>
  </div></div>;
}
export function CheckSheetStrip({ item, stamp, previous, onSelect }: { item: CheckItem; stamp?: CheckStamp; previous?: boolean; onSelect: () => void }) {
  return <button type="button" className={`strip ${previous ? 'prev' : ''}`} onClick={onSelect}>
    <span className="sn num">{item.itemKey}</span><span className="sq">{item.label}</span>
    {stamp ? <span className="sv num">{stamp.flagged ? stamp.ngReason : Object.values(stamp.values).join('　')}</span>
      : item.roleKeys.length ? <span className="role-tag">{item.roleKeys.map(roleLabel).join('・')}</span> : <span />}
    {stamp ? <span className={`mini-seal ${stamp.result === 'NG' ? 'ng' : ''}`}>{stamp.result === 'NA' ? '—' : familyName(stamp.employeeNameSnapshot)}</span> : <span className="mini-empty" />}
  </button>;
}
type Props = {
  item: CheckItem; groupLabel: string; draft: CheckDraft; stamp?: CheckStamp; busy: boolean; completed: boolean;
  condition?: 'applies' | 'na'; onCondition: (value: 'applies' | 'na') => void;
  onDraft: (draft: CheckDraft) => void;
};
export function CheckSheetCard({ item, groupLabel, draft, stamp, busy, completed, condition, onCondition, onDraft }: Props) {
  const ready = !completed && (condition === 'na' || !!stampInput(item, draft, condition, 'ready'));
  const showStamp = stamp && (completed || busy || draft.result === null);
  const role = item.roleKeys.map(roleLabel).join('・');
  const set = (patch: Partial<CheckDraft>) => onDraft({ ...draft, ...patch });
  const showControls = !completed && (!item.conditionKey || condition === 'applies');
  return <div className={`card ${draft.result === 'NG' ? 'ngmode' : ''}`}>
    <div className="crumb"><span className="ino num">{item.itemKey}</span><span className="gn">{item.groupNo}{'\u3000'}{groupLabel}</span>{role && <span className="role-tag">{role}</span>}</div>
    <div className="cbody"><h2 className="q">{item.label}</h2>{item.note && <div className="note">{item.note}</div>}
      {item.conditionKey && !completed && <div className="cond"><span className="cl">{item.conditionLabel}</span><div className="seg" role="group" aria-label="条件">
        <button disabled={busy} type="button" aria-pressed={condition === 'applies'} onClick={() => onCondition('applies')}>該当</button>
        <button disabled={busy} type="button" aria-pressed={condition === 'na'} onClick={() => onCondition('na')}>該当なし</button>
      </div></div>}
      {showControls && <div className="ctrl">
        {(item.inputSpec.fields ?? []).map((field) => <label className="f" key={field.key}>{field.label}
          <input disabled={busy} className={item.inputKind === 'NUMBER' ? 'n' : 't'} inputMode={item.inputKind === 'NUMBER' ? 'decimal' : 'text'} value={draft.values[field.key] ?? ''}
            onChange={(event) => set({ values: { ...draft.values, [field.key]: event.target.value } })} />
          {field.unit && <span className="unit">{field.unit}</span>}
        </label>)}
        {item.inputKind === 'CHOICE' && <div className="seg" role="group" aria-label="選択肢">{item.inputSpec.options?.map((option) =>
          <button type="button" disabled={busy} key={option} aria-pressed={draft.values.result === option} onClick={() => set({
            values: { ...draft.values, result: option }, result: option === 'NG' ? 'NG' : 'OK', ngAction: null
          })}>{option}</button>)}</div>}
        {item.inputKind !== 'CHOICE' && <div className="seg okng" role="group" aria-label="判定">{(['OK', 'NG'] as const).map((result) =>
          <button type="button" key={result} data-v={result} disabled={busy} aria-pressed={draft.result === result} onClick={() => set({ result, ngAction: null })}>{result}</button>)}</div>}
      </div>}
      {draft.result === 'NG' && !completed && <div className="ngbox">
        <input aria-label="問題点" placeholder="問題点" disabled={busy} value={draft.ngReason} onChange={(event) => set({ ngReason: event.target.value })} />
        <button type="button" className="btn" disabled={busy} aria-pressed={draft.ngAction === 'pause'} onClick={() => set({ ngAction: 'pause' })}>中断</button>
        <button type="button" className="btn mark" disabled={busy || !draft.ngReason.trim()} aria-pressed={draft.ngAction === 'flag'} onClick={() => set({ ngAction: 'flag' })}>目印を付けて次へ</button>
      </div>}
      {completed && stamp && <div className="ctrl">{Object.entries(stamp.values).map(([key, value]) => <span className="f" key={key}>{item.inputSpec.fields?.find((field) => field.key === key)?.label} {value}</span>)}</div>}
    </div>
    <div className="stampcol">{showStamp ? <CheckSheetSeal stamp={stamp} /> : <div className={`slot ${ready ? 'ready' : ''}`}><span className="need">{role && <>{role}<br /></>}印</span></div>}</div>
    {ready ? <CheckSheetNfcPrompt role={role} ng={draft.result === 'NG'} /> : <div />}
  </div>;
}

export function CheckSheetNfcPrompt({ role = '', ng = false }: { role?: string; ng?: boolean }) {
  return <div className={`nfc ${ng ? 'ng' : role ? 'role' : ''}`} role="status"><span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 8.5a8 8 0 0 1 0 7M9.5 6.5a12 12 0 0 1 0 11M13 4.5a16 16 0 0 1 0 15" /></svg></span>{role ? `${role}のタグ` : '社員タグ'}をかざす</div>;
}
