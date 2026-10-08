import { Input } from '../../../components/ui/Input';

import { procedureManualModelKey } from './ProcedureManualAssignmentDialog';
import { ProcedureManualModelMatch, ProcedureManualModelTenkey } from './ProcedureManualModelSearch';

import type { ProcedureManualAssignmentOverviewItemDto, ProcedureManualModelDto, ProcedureManualProcessDto } from '../types';

type Props = {
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
  onSearchChange, onDigitQueryChange, onModelSelect, onProcessSelect, loading, error, hasMore }: Props) {
  const inModel = items.filter(item => !modelCodeKey || item.modelCodeKey === modelCodeKey);
  const inProcess = items.filter(item => !processId || item.processId === processId);
  const visibleModels = models.filter(model => !processId || modelCodeKey || search || digitQuery || inProcess.some(item => item.modelCodeKey === model.modelCodeKey));
  const buttons = [{ id: '', name: '全て' }, ...processes.filter(row => row.parentId).map(row => ({ id: row.id, name: row.name.replace(/工程/g, '') }))];
  return <section aria-label="機種一覧" className="flex min-h-0 flex-1 flex-col gap-2.5 border-r border-[#27313b] bg-[#161c22] p-4">
    <h2 className="text-base font-bold tracking-widest text-[#9fadb9]">工程</h2>
    <div role="group" aria-label="工程で絞り込み" className="grid shrink-0 gap-1.5" style={{ gridTemplateColumns: `repeat(${buttons.length}, minmax(0,1fr))` }}>
      {buttons.map(button => {
        const count = inModel.filter(item => !button.id || item.processId === button.id).length;
        return <button key={button.id} aria-label={button.name} aria-pressed={processId === button.id}
          className={`flex h-14 flex-col items-center justify-center rounded-lg border text-[19px] font-bold leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7cc4ff] ${processId === button.id ? 'border-[#f6b93b] bg-[#f6b93b] text-[#0b1a12]' : 'border-[#344252] text-[#9fadb9]'}`}
          onClick={() => onProcessSelect(processId === button.id ? '' : button.id)}>
          {button.name}<span aria-hidden="true" className="font-mono text-sm font-normal">{count || '—'}</span>
        </button>;
      })}
    </div>
    <h2 className="text-base font-bold tracking-widest text-[#9fadb9]">機種</h2>
    <Input type="search" aria-label="機種検索" placeholder="型番で検索" maxLength={120} value={search} onChange={event => onSearchChange(event.target.value)} className="h-12 shrink-0 text-[21px]" />
    <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)] gap-3">
      <div><output aria-label="数字検索" className="block h-[26px] text-xl">{digitQuery}</output>
        <ProcedureManualModelTenkey value={digitQuery} onChange={onDigitQueryChange} />
      </div>
      <section aria-label="機種候補" className="flex min-h-0 min-w-0 flex-col gap-0.5 overflow-auto">
        {loading ? <p role="status">検索中…</p> : error ? <p role="alert" className="text-red-400">{error}</p> : visibleModels.length === 0 ? <p className="text-[#9fadb9]">該当する機種がありません</p> : null}
        {visibleModels.map(model => <button key={model.modelCodeKey} aria-label={model.modelCodeKey} aria-current={model.modelCodeKey === modelCodeKey ? 'true' : undefined} aria-pressed={model.modelCodeKey === modelCodeKey}
          className={`flex min-h-12 shrink-0 items-center rounded-lg px-3 text-left font-mono text-[18px] font-bold ${model.modelCodeKey === modelCodeKey ? 'bg-[#27313b]' : 'hover:bg-[#27313b]'}`}
          onClick={() => onModelSelect(model.modelCodeKey)}>
          <span className="min-w-0 break-all"><ProcedureManualModelMatch code={model.modelCodeKey} search={digitQuery || procedureManualModelKey(search)} /></span>
          <span aria-hidden="true" className="ml-auto pl-2 text-base font-normal text-[#9fadb9]">{inProcess.filter(item => item.modelCodeKey === model.modelCodeKey).length || '—'}</span>
        </button>)}
        {hasMore ? <p className="text-[#9fadb9]">数字を追加</p> : null}
      </section>
    </div>
  </section>;
}
