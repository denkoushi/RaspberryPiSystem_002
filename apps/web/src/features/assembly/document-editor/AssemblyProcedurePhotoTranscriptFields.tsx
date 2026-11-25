import { OVERLAY_IMAGE_TRANSCRIPT_LIMITS as limits, overlayImageTranscriptSchema } from '@raspi-system/shared-types';
import { useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import type { AssemblyProcedureTextCandidateDto } from '../types';
import type { AssemblyProcedureImageOverlayElement, OverlayImageTranscript } from '@raspi-system/shared-types';

const colors = ['#ff0000', '#ffd400', '#1e90ff', '#22a35a'];
const fieldClass = 'min-h-11 min-w-0 rounded border border-slate-500 bg-white px-2 text-slate-900';
const buttonClass = 'min-h-11 !px-2';

function candidateRows(candidates: AssemblyProcedureTextCandidateDto[], kind: OverlayImageTranscript['kind']) {
  const lines: { bounds: AssemblyProcedureTextCandidateDto['bounds']; parts: AssemblyProcedureTextCandidateDto[] }[] = [];
  for (const candidate of candidates) {
    if (!candidate.text.trim()) continue;
    const { bounds, text } = candidate;
    const line = bounds && !/[\r\n]/.test(text) ? lines.find(({ bounds: anchor }) => {
      if (!anchor) return false;
      const overlap = Math.min(anchor.yRatio + anchor.heightRatio, bounds.yRatio + bounds.heightRatio)
        - Math.max(anchor.yRatio, bounds.yRatio);
      return overlap > 0 && overlap >= Math.min(anchor.heightRatio, bounds.heightRatio) / 2;
    }) : undefined;
    if (line) line.parts.push(candidate);
    else lines.push({ bounds: /[\r\n]/.test(text) ? null : bounds, parts: [candidate] });
  }
  if (lines.every(({ bounds }) => bounds !== null)) {
    lines.sort((a, b) => a.bounds!.yRatio - b.bounds!.yRatio);
  }

  return lines.flatMap(({ parts }) => {
    const text = parts.sort((a, b) => (a.bounds?.xRatio ?? 0) - (b.bounds?.xRatio ?? 0))
      .map(part => part.text.trim()).join(kind === 'table' ? '  ' : ' ');
    return text.split(/\r\n?|\n/).map(line => line.trim()).filter(Boolean)
      .map(line => (kind === 'table' ? line.split(/\t+|[^\S\r\n]{2,}/) : [line])
        .slice(0, limits.columns).map(cell => cell.trim().slice(0, limits.cell)));
  }).slice(0, limits.rows);
}

export type ReadPhotoText = (image: AssemblyProcedureImageOverlayElement) => Promise<AssemblyProcedureTextCandidateDto[]>;

export function AssemblyProcedurePhotoTranscriptFields({ image, readText, disabled, onConfirm }: {
  image: AssemblyProcedureImageOverlayElement;
  readText?: ReadPhotoText;
  disabled: boolean;
  onConfirm: (transcript: OverlayImageTranscript | null) => void;
}) {
  const saved = image.transcript ?? null;
  const [draft, setDraft] = useState<OverlayImageTranscript>(() => saved ??
    { assetId: image.assetId, kind: 'table', rows: [['']], sel: [], choices: [] });
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stale = !!saved && saved.assetId !== image.assetId;
  const cols = Math.max(1, ...draft.rows.map(row => row.length));
  const isTable = draft.kind === 'table';
  const parsedDraft = overlayImageTranscriptSchema.safeParse({ ...draft, assetId: image.assetId });
  const confirmed = !stale && saved && parsedDraft.success &&
    JSON.stringify(parsedDraft.data) === JSON.stringify(overlayImageTranscriptSchema.parse(saved));
  const hasContent = draft.rows.some(row => row.some(cell => cell.trim())) || Boolean(draft.title?.trim());

  async function read() {
    if (!readText || !image.assetId || reading) return;
    setReading(true);
    setError(null);
    try {
      const candidates = await readText(image);
      const rows = candidateRows(candidates, draft.kind);
      if (!rows.length) {
        setError('文字が見つかりませんでした。');
        return;
      }
      setDraft(current => ({ ...current, rows, sel: [], choices: [] }));
    } catch (cause) {
      setError(readAssemblyApiErrorMessage(cause, '写真の文字を読み取れませんでした。'));
    } finally {
      setReading(false);
    }
  }

  function setKind(kind: OverlayImageTranscript['kind']) {
    if (kind === draft.kind) return;
    setDraft({
      ...draft,
      kind,
      title: undefined,
      rows: kind === 'list' ? draft.rows.map(row => [row.filter(Boolean).join(' ').slice(0, limits.cell)]) : draft.rows,
      sel: kind === 'list' ? draft.sel.slice(0, 1) : draft.sel.filter(row => row !== 0),
      choices: []
    });
  }

  function removeRow(index: number) {
    setDraft({
      ...draft,
      rows: draft.rows.filter((_, row) => row !== index),
      sel: draft.sel.filter(row => row !== index && (!isTable || index !== 0 || row !== 1))
        .map(row => row > index ? row - 1 : row),
      choices: draft.choices.filter(choice => choice.row !== index)
        .map(choice => choice.row > index ? { ...choice, row: choice.row - 1 } : choice)
    });
  }

  function updateChoice(index: number, patch: Partial<OverlayImageTranscript['choices'][number]>) {
    setDraft({ ...draft, choices: draft.choices.map((choice, i) => i === index ? { ...choice, ...patch } : choice) });
  }

  return <fieldset disabled={disabled || reading} className="grid min-w-0 gap-1 font-semibold">
    <legend>写真の文字</legend>
    <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
      {(['table', 'list'] as const).map(kind => <Button key={kind} type="button" variant="ghostOnDark"
        className={`${buttonClass} aria-pressed:!border-[#5fc3e8] aria-pressed:!bg-[#5fc3e81f] aria-pressed:!text-[#5fc3e8]`}
        aria-pressed={draft.kind === kind} onClick={() => setKind(kind)}>{kind === 'table' ? '表' : '一覧'}</Button>)}
      <Button type="button" variant="ghostOnDark" className={buttonClass} aria-busy={reading}
        disabled={!readText || !image.assetId} onClick={() => void read()}>{reading ? '読み取り中…' : '読み取る'}</Button>
    </div>
    {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    <div className={`grid min-w-0 gap-1 rounded border p-1 ${stale ? 'border-amber-400' : 'border-transparent'}`} data-stale={stale}>
      <div className={`grid min-w-0 gap-1 overflow-x-auto ${stale ? 'opacity-55' : ''}`}>
        {!isTable ? <input className={fieldClass} aria-label="見出し" maxLength={limits.cell}
          value={draft.title ?? ''} onChange={event => setDraft({ ...draft, title: event.target.value || undefined })} /> : null}
        {draft.rows.map((row, ri) => {
          const header = isTable && ri === 0;
          const selected = draft.sel.includes(ri);
          return <div key={ri} className="grid items-center gap-1" style={{
            gridTemplateColumns: `2.75rem repeat(${cols}, minmax(4rem, 1fr)) 2.75rem`
          }}>
            {header ? <span /> : <Button type="button" variant="ghostOnDark"
              className={`${buttonClass} aria-pressed:!border-[#0078d7] aria-pressed:!bg-[#0078d7]`}
              aria-label={`${ri + 1}行目を選択中にする`} aria-pressed={selected}
              onClick={() => setDraft({ ...draft, sel: selected ? draft.sel.filter(i => i !== ri) : isTable ? [...draft.sel, ri] : [ri] })} />}
            {Array.from({ length: cols }, (_, ci) => <input key={ci}
              className={`${fieldClass} ${selected ? '!border-[#0078d7] !bg-[#0078d7] !text-white' : header ? '!bg-[#f3f3f3]' : ''}`}
              aria-label={`${ri + 1}行${ci + 1}列`} maxLength={limits.cell} value={row[ci] ?? ''}
              onChange={event => {
                const value = event.target.value;
                setDraft({ ...draft, rows: draft.rows.map((cells, i) => i === ri
                  ? Array.from({ length: Math.max(cells.length, ci + 1) }, (_, col) => col === ci ? value : cells[col] ?? '') : cells) });
              }} />)}
            <Button type="button" variant="ghostOnDark" className={`${buttonClass} !border-transparent`}
              aria-label={`${ri + 1}行目を消す`} onClick={() => removeRow(ri)}>✕</Button>
          </div>;
        })}
      </div>
      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="ghostOnDark" className={buttonClass} disabled={draft.rows.length >= limits.rows}
          onClick={() => setDraft({ ...draft, rows: [...draft.rows, Array<string>(cols).fill('')] })}>＋ 行</Button>
        {isTable ? <Button type="button" variant="ghostOnDark" className={buttonClass}
          disabled={!draft.rows.length || cols >= limits.columns}
          onClick={() => setDraft({ ...draft, rows: draft.rows.map(row => Array.from({ length: cols + 1 }, (_, col) => row[col] ?? '')) })}>＋ 列</Button> : null}
      </div>
    </div>
    {!isTable ? <fieldset className="grid min-w-0 gap-1">
      <legend>選択肢</legend>
      {draft.choices.map((choice, index) => <div key={index} className="grid grid-cols-[2.75rem_minmax(0,1fr)_3.5rem_2.75rem] gap-1">
        <Button type="button" variant="ghostOnDark" className={`${buttonClass} grid place-items-center`} aria-label={`選択肢${index + 1}の色を変える`}
          onClick={() => updateChoice(index, { color: colors[(colors.indexOf(choice.color) + 1) % colors.length] })}>
          <span className="h-1.5 w-5" style={{ backgroundColor: choice.color }} />
        </Button>
        <input className={fieldClass} aria-label={`選択肢${index + 1}の名前`} maxLength={limits.label} value={choice.label}
          onChange={event => updateChoice(index, { label: event.target.value })} />
        <select className={fieldClass} aria-label={`選択肢${index + 1}の行`} value={choice.row}
          onChange={event => updateChoice(index, { row: Number(event.target.value) })}>
          {draft.rows.map((_, row) => <option key={row} value={row}>{row + 1}</option>)}
        </select>
        <Button type="button" variant="ghostOnDark" className={`${buttonClass} !border-transparent`}
          aria-label={`選択肢${index + 1}を消す`} onClick={() => setDraft({ ...draft, choices: draft.choices.filter((_, i) => i !== index) })}>✕</Button>
      </div>)}
      <Button type="button" variant="ghostOnDark" className={`${buttonClass} justify-self-start`}
        disabled={!draft.rows.length || draft.choices.length >= limits.choices}
        onClick={() => setDraft({ ...draft, choices: [...draft.choices, { label: '', color: colors[draft.choices.length % colors.length], row: 0 }] })}>＋ 選択肢</Button>
    </fieldset> : null}
    <div className="flex justify-between gap-1">
      <Button type="button" variant={confirmed || stale ? 'ghostOnDark' : 'primary'}
        className={`${buttonClass} ${stale ? '!border-amber-400 !bg-amber-400 !text-slate-900' : confirmed ? '!text-emerald-400' : ''}`}
        disabled={!!confirmed || !parsedDraft.success || (!hasContent && !saved) || draft.choices.some(choice => !choice.label.trim())}
        onClick={() => { if (parsedDraft.success) onConfirm(parsedDraft.data); }}>
        {stale ? 'この写真で確定' : confirmed ? '確定済み' : '確定'}
      </Button>
      {saved ? <Button type="button" variant="ghostOnDark" className={buttonClass} onClick={() => onConfirm(null)}>消す</Button> : null}
    </div>
  </fieldset>;
}
