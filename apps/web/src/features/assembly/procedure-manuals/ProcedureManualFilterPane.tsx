import { useState } from 'react';

import { Input } from '../../../components/ui/Input';
import { normalizeWorkInstructionPartNumber } from '../../../lib/workInstructionRules';
import { useKeyboardWedgeScan } from '../../barcode-scan/useKeyboardWedgeScan';

import { procedureManualButtonBase, procedureManualButtonSelected, procedureManualButtonUnselected } from './procedure-manual-button-styles';
import { procedureManualModelKey } from './ProcedureManualAssignmentDialog';
import { ProcedureManualModelMatch, ProcedureManualModelTenkey } from './ProcedureManualModelSearch';

import type { ProcedureManualAssignmentOverviewItemDto, ProcedureManualModelDto, ProcedureManualProcessDto } from '../types';

type Props = {
  allowKindChangeWithProcess?: boolean;
  subjectKind: 'MODEL' | 'PART';
  onKindChange: (kind: 'MODEL' | 'PART') => void;
  partCandidates?: ProcedureManualModelDto[];
  processes: ProcedureManualProcessDto[];
  items: ProcedureManualAssignmentOverviewItemDto[];
  models: ProcedureManualModelDto[];
  modelCodeKey: string;
  processId: string;
  search: string;
  digitQuery: string;
  onSearchChange: (value: string) => void;
  onDigitQueryChange: (value: string) => void;
  onModelSelect: (value: string) => void;
  onProcessSelect: (value: string) => void;
  loading?: boolean;
  error?: string | null;
  hasMore?: boolean;
};

export function ProcedureManualFilterPane({ processes, items, models, modelCodeKey, processId, search, digitQuery,
  onSearchChange, onDigitQueryChange, onModelSelect, onProcessSelect, loading, error, hasMore, subjectKind, onKindChange, partCandidates, allowKindChangeWithProcess = false }: Props) {
  const isPart = subjectKind === 'PART';
  const unit = isPart ? '部品' : '機種';
  const [scanArmed, setScanArmed] = useState(false);
  useKeyboardWedgeScan({ active: isPart && scanArmed, onScan: text => {
    const key = normalizeWorkInstructionPartNumber(text);
    setScanArmed(false); onDigitQueryChange(''); onSearchChange(key); if (key && key !== modelCodeKey) onModelSelect(key);
  } });
  const partKeys = [...new Set([...(partCandidates ?? []).map(row => row.modelCodeKey), ...items.filter(item => processes.find(process => process.id === item.processId)?.subjectKind === 'PART').map(item => item.modelCodeKey)])];
  const typedPart = normalizeWorkInstructionPartNumber(search);
  if (typedPart && !partKeys.includes(typedPart)) partKeys.push(typedPart);
  const candidateModels = isPart ? partKeys.filter(key => key.includes(typedPart) && key.includes(digitQuery)).sort().map(key => ({ modelCode: key, modelCodeKey: key })) : models;
  const inModel = items.filter(item => !modelCodeKey || (item.modelCodeKey === modelCodeKey && (processes.find(process => process.id === item.processId)?.subjectKind ?? 'MODEL') === subjectKind));
  const inProcess = items.filter(item => (!processId || item.processId === processId) && (processes.find(process => process.id === item.processId)?.subjectKind ?? 'MODEL') === subjectKind);
  const visibleModels = candidateModels.filter(model => !processId || isPart || modelCodeKey || search || digitQuery || inProcess.some(item => item.modelCodeKey === model.modelCodeKey));
  const buttons = [{ id: '', name: '全て' }, ...processes.filter(row => row.parentId).map(row => ({ id: row.id, name: row.name.replace(/工程/g, '') }))];
  return <section aria-label={`${unit}一覧`} className="flex min-h-0 flex-1 flex-col gap-2.5 border-r border-[#27313b] bg-[#161c22] p-4">
    <h2 className="text-base font-bold tracking-widest text-[#9fadb9]">工程</h2>
    <div role="group" aria-label="工程で絞り込み" className="grid shrink-0 gap-1.5" style={{ gridTemplateColumns: `repeat(${buttons.length}, minmax(0,1fr))` }}>
      {buttons.map(button => {
        const count = inModel.filter(item => !button.id || item.processId === button.id).length;
        return <button key={button.id} aria-label={button.name} aria-pressed={processId === button.id}
          className={`${procedureManualButtonBase} flex h-14 flex-col items-center justify-center text-[19px] font-bold leading-tight ${processId === button.id ? procedureManualButtonSelected : `${procedureManualButtonUnselected} text-[#9fadb9]`}`}
          onClick={() => { setScanArmed(false); onProcessSelect(processId === button.id ? '' : button.id); }}>
          {button.name}<span aria-hidden="true" className="font-mono text-sm font-normal">{count || '—'}</span>
        </button>;
      })}
    </div>
    <h2 className="text-base font-bold tracking-widest text-[#9fadb9]">{unit}{!processId || allowKindChangeWithProcess ? <span role="group" aria-label="機種か部品か" className="ml-3 inline-flex gap-1">{(['MODEL', 'PART'] as const).map(kind => <button key={kind} aria-pressed={subjectKind === kind} className={`${procedureManualButtonBase} px-3 ${subjectKind === kind ? procedureManualButtonSelected : procedureManualButtonUnselected}`} onClick={() => { setScanArmed(false); onKindChange(kind); }}>{kind === 'PART' ? '部品' : '機種'}</button>)}</span> : null}</h2>
    <div className="flex shrink-0 gap-2"><Input type="search" aria-label={`${unit}検索`} placeholder={isPart ? '品番で検索' : '型番で検索'} maxLength={120} value={search} onChange={event => onSearchChange(event.target.value)} className={`h-12 ${isPart ? 'min-w-0 flex-1' : 'shrink-0'} text-[21px]`} />{isPart ? <button aria-label={scanArmed ? 'スキャン中止' : '品番をスキャン'} aria-pressed={scanArmed} className={`${procedureManualButtonBase} w-12 shrink-0 ${scanArmed ? procedureManualButtonSelected : procedureManualButtonUnselected}`} onClick={() => setScanArmed(!scanArmed)}><svg aria-hidden="true" className="mx-auto h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8V5h3M21 8V5h-3M3 16v3h3M21 16v3h-3M7 8v8M10 8v8M13 8v8M17 8v8" /></svg></button> : null}</div>
    <div className="grid min-h-0 flex-1 grid-cols-[64px_minmax(0,1fr)] gap-3">
      <div className="min-w-0"><output aria-label="数字検索" className="block h-[26px] truncate text-xl">{digitQuery}</output>
        <ProcedureManualModelTenkey value={digitQuery} onChange={onDigitQueryChange} ariaLabel={`${unit}テンキー`} column />
      </div>
      <section aria-label={`${unit}候補`} className="flex min-h-0 min-w-0 flex-col gap-1.5 overflow-auto">
        {loading ? <p role="status">検索中…</p> : error ? <p role="alert" className="text-red-400">{error}</p> : visibleModels.length === 0 ? <p className="text-[#9fadb9]">該当する{unit}がありません</p> : null}
        {visibleModels.map(model => <button key={model.modelCodeKey} aria-label={model.modelCodeKey} aria-current={model.modelCodeKey === modelCodeKey ? 'true' : undefined} aria-pressed={model.modelCodeKey === modelCodeKey}
          className={`${procedureManualButtonBase} flex shrink-0 items-center px-3 text-left font-mono text-[18px] font-bold ${model.modelCodeKey === modelCodeKey ? procedureManualButtonSelected : procedureManualButtonUnselected}`}
          onClick={() => onModelSelect(model.modelCodeKey)}>
          <span className="min-w-0 break-all"><ProcedureManualModelMatch code={model.modelCodeKey} search={digitQuery || (isPart ? typedPart : procedureManualModelKey(search))} /></span>
          <span aria-hidden="true" className="ml-auto pl-2 text-base font-normal text-[#9fadb9]">{inProcess.filter(item => item.modelCodeKey === model.modelCodeKey).length || '—'}</span>
        </button>)}
        {hasMore ? <p className="text-[#9fadb9]">数字を追加</p> : null}
      </section>
    </div>
  </section>;
}
