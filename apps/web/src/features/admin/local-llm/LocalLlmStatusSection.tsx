import { useCallback, useEffect, useState } from 'react';

import { getLocalLlmApiErrorMessage, getLocalLlmStatus } from '../../../api/local-llm';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';

import type { LocalLlmStatus } from '../../../api/local-llm.types';

function trimBody(body: string | undefined, max = 400): string {
  if (!body) return '';
  const t = body.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export function LocalLlmStatusSection() {
  const [data, setData] = useState<LocalLlmStatus | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { httpStatus: s, body } = await getLocalLlmStatus();
      setHttpStatus(s);
      setData(body);
    } catch (e) {
      setData(null);
      setHttpStatus(null);
      setError(getLocalLlmApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const degraded = httpStatus === 503 || (data && !data.health.ok);

  return (
    <Card
      title="LocalLLM ステータス"
      action={
        <Button type="button" variant="secondary" disabled={loading} onClick={() => void load()}>
          再読込
        </Button>
      }
    >
      {loading && !data ? (
        <p className="text-sm text-slate-600">読み込み中…</p>
      ) : null}
      {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
      {data ? (
        <dl className="grid gap-2 text-sm text-slate-800 sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-slate-600">HTTP</dt>
            <dd>{httpStatus ?? '—'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-600">全体</dt>
            <dd className={degraded ? 'font-medium text-amber-800' : 'font-medium text-emerald-800'}>
              {degraded ? '利用に注意（未設定またはヘルス NG）' : '利用可能'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-600">configured</dt>
            <dd>{data.configured ? 'true' : 'false'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-600">timeoutMs</dt>
            <dd>{data.timeoutMs}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-semibold text-slate-600">baseUrl</dt>
            <dd className="break-all">{data.baseUrl ?? '—'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-semibold text-slate-600">model</dt>
            <dd className="break-all">{data.model ?? '—'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-600">health.ok</dt>
            <dd>{data.health.ok ? 'true' : 'false'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-600">health.statusCode</dt>
            <dd>{data.health.statusCode ?? '—'}</dd>
          </div>
          {data.health.error ? (
            <div className="sm:col-span-2">
              <dt className="font-semibold text-slate-600">health.error</dt>
              <dd className="whitespace-pre-wrap break-words text-red-800">{data.health.error}</dd>
            </div>
          ) : null}
          {data.health.body ? (
            <div className="sm:col-span-2">
              <dt className="font-semibold text-slate-600">health.body（先頭のみ）</dt>
              <dd className="whitespace-pre-wrap break-words font-mono text-xs text-slate-700">
                {trimBody(data.health.body)}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </Card>
  );
}
