import { useState } from 'react';

import { getClientApiKey } from '../../api/domains/clients';
import { Button } from '../../components/ui/Button';

export function ClientApiKey({ id }: { id: string }) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reveal = async () => {
    setLoading(true);
    setError(null);
    try {
      setApiKey(await getClientApiKey(id));
    } catch {
      setError('キーの取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (apiKey === null) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-1">
      <p className="text-xs font-bold text-slate-700">APIキー</p>
      {apiKey === null ? (
        <Button type="button" variant="ghost" disabled={loading} onClick={reveal}>キーを表示</Button>
      ) : (
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-slate-100 px-2 py-1.5 font-mono text-xs font-semibold">
            {apiKey}
          </code>
          <Button
            type="button"
            variant="ghost"
            onClick={copy}
            className="shrink-0 border-2 border-slate-300 px-3 py-1 text-xs"
          >
            {copied ? 'コピー済み' : 'コピー'}
          </Button>
        </div>
      )}
      {error ? <p className="text-xs font-semibold text-red-600">{error}</p> : null}
    </div>
  );
}

