import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { getAssemblyTemplate, startAssemblyWorkSession } from '../../api/client';
import { Button, buttonClassName } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  kioskAssemblyTemplateEditPath,
  kioskAssemblyWorkSessionPath,
  KIOSK_ASSEMBLY_LIBRARY_PATH,
  parseAssemblyWorkStartSearch,
  readAssemblyApiErrorMessage
} from '../../features/assembly';

import type { AssemblyTemplateDto } from '../../features/assembly/types';

export function KioskAssemblyWorkStartPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { templateId } = useMemo(() => parseAssemblyWorkStartSearch(location.search), [location.search]);
  const [template, setTemplate] = useState<AssemblyTemplateDto | null>(null);
  const [form, setForm] = useState({
    productNo: '',
    serialNo: '',
    nameplateNo: '',
    operatorNameSnapshot: '',
    targetUnit: '',
    torqueWrenchId: 'CEM20N3X10D-BTLA'
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!templateId) {
      setLoading(false);
      setMessage('テンプレートが指定されていません。');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setMessage(null);
    void getAssemblyTemplate(templateId)
      .then((next) => {
        if (cancelled) return;
        setTemplate(next);
        setForm((current) => ({ ...current, targetUnit: current.targetUnit || next.areas[0]?.unitCode || '' }));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setMessage(readAssemblyApiErrorMessage(e, 'テンプレートの取得に失敗しました。'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const startWork = async () => {
    if (!templateId) return;
    setBusy(true);
    setMessage(null);
    try {
      const session = await startAssemblyWorkSession({ ...form, templateId });
      navigate(kioskAssemblyWorkSessionPath(session.id), { replace: true });
    } catch (e: unknown) {
      setMessage(readAssemblyApiErrorMessage(e, '組立作業の開始に失敗しました。'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-800 text-white">読込中…</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/15 bg-slate-900/70 p-2">
        <div className="min-w-0">
          <h1 className="text-[1.28rem] font-bold leading-tight">組立作業開始</h1>
          <p className="mt-1 truncate text-sm text-white/60">
            {template ? `${template.modelCode} / ${template.procedurePattern} v${template.version}` : 'テンプレート未選択'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={KIOSK_ASSEMBLY_LIBRARY_PATH} className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 items-center')}>
            一覧へ
          </Link>
          {template ? (
            <Link
              to={kioskAssemblyTemplateEditPath(template.id)}
              className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 items-center')}
            >
              テンプレ
            </Link>
          ) : null}
        </div>
      </div>

      {message ? <p className="rounded border border-white/15 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-amber-200">{message}</p> : null}

      <main className="mx-auto grid w-full max-w-4xl gap-3 overflow-auto rounded border border-white/15 bg-slate-900/70 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {([
            ['productNo', '製番/M番号'],
            ['serialNo', 'シリアルNo.'],
            ['nameplateNo', '銘板No.'],
            ['operatorNameSnapshot', '作業者'],
            ['targetUnit', '対象ユニット'],
            ['torqueWrenchId', 'トルクレンチ']
          ] as const).map(([key, label]) => (
            <label key={key} className="grid gap-1 text-sm font-semibold text-white/70">
              {label}
              <Input
                value={form[key]}
                disabled={busy}
                onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="primary" className="min-h-12 min-w-[10rem] text-base" disabled={busy || !template?.isActive} onClick={() => void startWork()}>
            {busy ? '開始中…' : '組立開始'}
          </Button>
        </div>
      </main>
    </div>
  );
}
