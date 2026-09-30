import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { createRiggingInspectionRecord, getRiggingInspectionRecords } from '../../../api/domains/rigging';
import { getTagDeskRegistry } from '../../../api/domains/tag-desk';
import { getApiErrorMessage } from '../../../api/errors';

import { formatWhen, Section } from './TagDeskParts';
import { tagDesk } from './tagDeskTheme';

/** Inspection records of one rigging gear, with a one-line form to add today's result. */
export function RiggingInspectionPanel({ pin, riggingGearId }: { pin: string; riggingGearId: string }) {
  const queryClient = useQueryClient();
  const records = useQuery({ queryKey: ['kiosk-tag-desk', 'rigging-inspections', riggingGearId], queryFn: () => getRiggingInspectionRecords(riggingGearId) });
  const employees = useQuery({ queryKey: ['kiosk-tag-desk', 'registry', 'employee'], queryFn: () => getTagDeskRegistry(pin, 'employee'), staleTime: 30_000 });
  const [employeeId, setEmployeeId] = useState('');
  const [result, setResult] = useState<'PASS' | 'FAIL'>('PASS');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: string) => employees.data?.find((row) => row.id === id)?.name ?? '—';

  const add = useMutation({
    mutationFn: () => createRiggingInspectionRecord({ riggingGearId, employeeId, result, notes: notes.trim() || null, inspectedAt: new Date().toISOString() }),
    onSuccess: async () => {
      setNotes('');
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['kiosk-tag-desk', 'rigging-inspections', riggingGearId] });
    },
    onError: (err) => setError(getApiErrorMessage(err, '記録できませんでした'))
  });

  return (
    <Section title="点検記録">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="点検者" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={`${tagDesk.input} w-44`}>
          <option value="">点検者</option>
          {(employees.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        <div className="flex rounded-[10px] border border-[#223043] p-0.5" role="radiogroup" aria-label="結果">
          {(['PASS', 'FAIL'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={result === value}
              onClick={() => setResult(value)}
              className={`h-9 rounded-lg px-3 text-sm font-bold ${result === value ? (value === 'PASS' ? 'bg-[#10352a] text-[#34d399]' : 'bg-[#3a1719] text-[#ff5d5d]') : 'text-[#8494a8]'}`}
            >
              {value === 'PASS' ? '合格' : '不合格'}
            </button>
          ))}
        </div>
        <input aria-label="備考" placeholder="備考" value={notes} onChange={(e) => setNotes(e.target.value)} className={`${tagDesk.input} w-40`} />
        <button type="button" className={`${tagDesk.btnSm} ${tagDesk.go}`} disabled={!employeeId || add.isPending} onClick={() => add.mutate()}>記録</button>
      </div>
      {error ? <p className="text-sm text-[#ff8a8a]" role="alert">{error}</p> : null}
      <div className="flex flex-col">
        {(records.data ?? []).slice(0, 4).map((record) => (
          <div key={record.id} className="grid h-[34px] grid-cols-[118px_64px_minmax(0,1fr)] items-center gap-3 border-b border-[#172131] text-[15px] last:border-b-0">
            <time className="font-mono text-sm tabular-nums text-[#8494a8]">{formatWhen(record.inspectedAt)}</time>
            <span className={record.result === 'PASS' ? 'font-bold text-[#34d399]' : 'font-bold text-[#ff5d5d]'}>{record.result === 'PASS' ? '合格' : '不合格'}</span>
            <span className="truncate text-white">{nameOf(record.employeeId)}{record.notes ? ` · ${record.notes}` : ''}</span>
          </div>
        ))}
        {records.data && records.data.length === 0 ? <p className="text-sm text-[#5c6d83]">まだありません</p> : null}
      </div>
    </Section>
  );
}
