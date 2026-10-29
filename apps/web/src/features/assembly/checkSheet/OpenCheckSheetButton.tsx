import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { listAssemblyCheckSheetRevisions, openAssemblyCheckSheet } from '../../../api/domains/assembly/check-sheets';
import { kioskAssemblyCheckSheetPath } from '../assemblyRoutes';

import type { AssemblyCheckSheetRevisionPayload } from '@raspi-system/shared-types';

export function OpenCheckSheetButton({ workUnitId, className }: { workUnitId: string; className: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<AssemblyCheckSheetRevisionPayload[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = async (rootId?: string) => {
    setBusy(true); setError(null);
    try {
      const sheet = await openAssemblyCheckSheet(workUnitId, rootId);
      navigate(kioskAssemblyCheckSheetPath(sheet.id));
    } catch (caught) {
      const data = (caught as { response?: { data?: { errorCode?: string; message?: string } } })?.response?.data;
      if (data?.errorCode === 'CHECK_SHEET_REVISION_REQUIRED') {
        try {
          const heads = await listAssemblyCheckSheetRevisions();
          setChoices(heads);
          if (!heads.length) setError('チェックシートがありません');
        } catch { setError('チェックシートを取得できませんでした'); }
      } else setError(data?.message ?? 'チェックシートを開けませんでした');
    } finally { setBusy(false); }
  };
  return <>
    <button type="button" className={className} disabled={busy} onClick={() => void open()}>チェックシート</button>
    {choices && choices.length > 0 && <select className={className} aria-label="チェックシートの機種" disabled={busy} value="" onChange={(event) => void open(event.target.value)}>
      <option value="" disabled>機種</option>{choices.map((choice) => <option value={choice.revisionRootId} key={choice.id}>{choice.modelCode}{'\u3000'}{choice.documentNo}</option>)}
    </select>}
    {error && <span role="alert" className="self-center text-sm text-amber-200">{error}</span>}
  </>;
}
