import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { getEmployees } from '../../api/domains/tools';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../../contexts/AuthContext';
import { getKnowledgeCapabilities, getKnowledgePositionRanks, saveKnowledgePositionRanks } from '../../features/hermes-knowledge/knowledgeReviewApi';

import type { KnowledgePositionRank, KnowledgePositionRankEntry } from '@raspi-system/shared-types';

type Row = KnowledgePositionRankEntry & { employeeCount: number; unmapped: boolean };
const choices: { rank: KnowledgePositionRank; label: string }[] = [
  { rank: 'general', label: '一般' }, { rank: 'leader', label: '班長相当' },
  { rank: 'section_chief', label: '係長相当' }, { rank: 'manager', label: '課長相当' },
];

function PositionRanksEditor() {
  const [rows, setRows] = useState<Row[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const capabilities = await getKnowledgeCapabilities();
        if (cancelled) return;
        setEnabled(capabilities.enabled);
        if (!capabilities.enabled) return;
        const [mapping, employees] = await Promise.all([getKnowledgePositionRanks(), getEmployees()]);
        if (cancelled) return;
        const counts = new Map<string, number>();
        for (const employee of employees) if (employee.positionName) counts.set(employee.positionName, (counts.get(employee.positionName) ?? 0) + 1);
        const mapped = new Set(mapping.ranks.map(row => row.positionName));
        setRows([
          ...mapping.ranks.map(row => ({ ...row, employeeCount: counts.get(row.positionName) ?? 0, unmapped: false })),
          ...mapping.unmappedPositions.filter(row => !mapped.has(row.positionName)).map(row => ({ ...row, rank: 'general' as const, unmapped: true })),
        ]);
      } catch { if (!cancelled) setError('職位の対応表を取得できません。'); }
      finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  async function save() {
    if (busy || enabled !== true) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      await saveKnowledgePositionRanks({ ranks: rows.map(({ positionName, rank }) => ({ positionName, rank })) });
      setRows(current => current.map(row => ({ ...row, unmapped: false }))); setSaved(true);
    } catch { setError('保存できません。'); }
    finally { setBusy(false); }
  }

  return <Card className="space-y-3">
    <h1 className="text-xl font-bold">職位の対応表</h1>
    {enabled === false ? <p>ナレッジは無効です。</p> : <>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {busy ? <p role="status" className="text-sm text-slate-600">読み込み中…</p> : null}
      {enabled === true ? <>
        <div className="overflow-x-auto"><table className="border-collapse text-sm">
          <thead><tr>{['職位名', '人数', '段階'].map(label => <th key={label} className="border-b border-slate-200 px-3 py-2 text-left">{label}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.positionName}>
            <td className="border-b border-slate-200 px-3 py-2">{row.positionName} {row.unmapped ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">未設定</span> : null}</td>
            <td className="border-b border-slate-200 px-3 py-2">{row.employeeCount}</td>
            <td className="border-b border-slate-200 px-3 py-2"><select aria-label={`${row.positionName}の段階`} value={row.rank} disabled={busy}
              onChange={event => { setSaved(false); setRows(current => current.map(item => item.positionName === row.positionName ? { ...item, rank: event.target.value as KnowledgePositionRank } : item)); }}
              className="h-11 rounded-lg border border-slate-300 bg-white px-2">
              {choices.map(choice => <option key={choice.rank} value={choice.rank}>{choice.label}</option>)}
            </select></td>
          </tr>)}</tbody>
        </table></div>
        <div className="flex items-center gap-3"><button type="button" disabled={busy} onClick={() => void save()} className="h-11 rounded-lg bg-blue-700 px-4 text-sm text-white disabled:opacity-40">保存</button>
          {saved ? <span role="status" className="text-sm text-green-700">保存しました</span> : null}</div>
      </> : null}
    </>}
  </Card>;
}

export function KnowledgePositionRanksPage() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') return <Navigate to="/admin" replace />;
  return <PositionRanksEditor />;
}
