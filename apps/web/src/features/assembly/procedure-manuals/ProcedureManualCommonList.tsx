import { normalizeProcedureManualCommonSubject } from '@raspi-system/shared-types';

import { ManualThumbnail } from './ManualThumbnail';
import { procedureManualButtonBase, procedureManualButtonUnselected } from './procedure-manual-button-styles';

import type { ProcedureManualAssignmentOverviewItemDto, ProcedureManualProcessDto } from '../types';

export function filterProcedureManualCommonItems(items: ProcedureManualAssignmentOverviewItemDto[], processes: ProcedureManualProcessDto[], categoryId: string, kanaRow: string, search: string) {
  const query = normalizeProcedureManualCommonSubject(search);
  return items.filter(item => (item.subjectKind === 'COMMON' || processes.some(process => process.id === item.processId && process.subjectKind === 'COMMON'))
    && (!categoryId || item.processId === categoryId) && (!kanaRow || item.kanaRow === kanaRow)
    && normalizeProcedureManualCommonSubject(item.title).includes(query));
}

export function ProcedureManualCommonList({ items, processes, categoryId, kanaRow, onView, onFix, onRemove, busy }: {
  items: ProcedureManualAssignmentOverviewItemDto[]; processes: ProcedureManualProcessDto[]; categoryId: string; kanaRow: string;
  onView: (item: ProcedureManualAssignmentOverviewItemDto) => void;
  onFix?: (item: ProcedureManualAssignmentOverviewItemDto) => void; onRemove?: (item: ProcedureManualAssignmentOverviewItemDto, deleteDocument: boolean) => void; busy?: boolean;
}) {
  const category = processes.find(row => row.id === categoryId)?.name;
  const button = `${procedureManualButtonBase} ${procedureManualButtonUnselected} h-12 px-2 text-[17px] font-bold disabled:opacity-40`;
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 p-5 px-7">
    <div className="flex shrink-0 items-center gap-3 text-[19px]">
      <h2 className="rounded-full border border-[#344252] px-3.5 py-1.5 text-lg">共通{category ? ` › ${category}` : ''}{kanaRow ? ` › ${kanaRow}行` : ''}</h2><span>{items.length} 件</span>
    </div>
    <div role="table" aria-label="共通の手順" className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
      {items.map(item => <div role="row" aria-label={item.title} key={item.assignmentId} className="grid h-[60px] shrink-0 items-center gap-3.5 rounded-lg border border-[#27313b] bg-[#161c22] px-3.5 text-xl" style={{ gridTemplateColumns: `64px minmax(0,1fr) 170px 110px 90px 64px${onFix ? ' 64px' : ''}${onRemove ? ' 56px' : ''}` }}>
        <div role="cell" className="[&>div]:h-[42px] [&>div]:w-14"><ManualThumbnail url={item.thumbnailPageUrl} /></div>
        <b role="cell" className="truncate">{item.title}</b>
        <span role="cell" className="truncate text-base text-[#9fadb9]">{item.category ?? processes.find(row => row.id === item.processId)?.name}</span>
        <span role="cell" className="text-base text-[#9fadb9]">{item.pageCount ?? '—'} ページ</span>
        <span role="cell" className={`rounded-full border py-0.5 text-center text-[15px] font-bold ${item.status === 'published' ? 'border-[#3ba776] text-[#3ba776]' : 'border-[#f6b93b] text-[#f6b93b]'}`}>{item.status === 'published' ? '公開' : item.status === 'draft' ? '下書き' : '無効'}</span>
        <button className={`${button} border-[#7cc4ff] text-[#7cc4ff]`} disabled={busy} onClick={() => onView(item)}>見る</button>
        {onFix ? <button className={button} disabled={busy || item.kind !== 'assembly_procedure_document'} onClick={() => onFix(item)}>直す</button> : null}
        {onRemove ? <button className={button} disabled={busy} onClick={() => onRemove(item, item.kind === 'assembly_procedure_document' && item.status === 'draft' && !item.draftRevision && item.otherAssignments.length === 0)}>{item.kind === 'assembly_procedure_document' && item.status === 'draft' && !item.draftRevision && item.otherAssignments.length === 0 ? '削除' : '外す'}</button> : null}
      </div>)}
      {!items.length ? <p className="py-7 text-xl text-[#9fadb9]">ありません</p> : null}
    </div>
  </div>;
}
