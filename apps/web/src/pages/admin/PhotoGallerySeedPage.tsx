import { Fragment, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';

import { usePhotoSimilarCandidates, usePostPhotoGallerySeed } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../../contexts/AuthContext';

function SimilarCandidatesPanel({ loanId }: { loanId: string }) {
  const { data, isLoading, isError } = usePhotoSimilarCandidates(loanId);
  if (isLoading) {
    return <p className="text-slate-600">類似候補を読み込み中…</p>;
  }
  if (isError) {
    return <p className="text-red-600">類似候補の取得に失敗しました。</p>;
  }
  if (!data || data.length === 0) {
    return (
      <p className="text-slate-600">
        類似候補はありません（埋め込み無効・閾値・ギャラリー件数のいずれかの可能性があります）。
      </p>
    );
  }
  return (
    <ul className="list-inside list-disc space-y-1 text-slate-800">
      {data.map((c) => (
        <li key={c.sourceLoanId}>
          <span className="font-medium">{c.canonicalLabel}</span>
          <span className="ml-2 text-slate-600">（score {c.score.toFixed(3)}）</span>
        </li>
      ))}
    </ul>
  );
}

export function PhotoGallerySeedPage() {
  const { user } = useAuth();
  const mutation = usePostPhotoGallerySeed();
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [lastLoanId, setLastLoanId] = useState<string | null>(null);
  const [showSimilar, setShowSimilar] = useState(false);

  if (!user) {
    return null;
  }

  if (user.role === 'VIEWER') {
    return <Navigate to="/admin" replace />;
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!file || !label.trim()) {
      return;
    }
    mutation.mutate(
      { image: file, canonicalLabel: label.trim() },
      {
        onSuccess: (data) => {
          setLastLoanId(data.loanId);
          setShowSimilar(false);
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">類似ギャラリー教師の登録</h1>
        <p className="mt-1 text-sm text-slate-600">
          JPEG 画像と教師ラベル（工具名など）を1件ずつ登録します。実貸出ではなく類似検索用の参照行として{' '}
          <code className="rounded bg-slate-100 px-1">Loan</code> を作成し、即返却扱いのためキオスクの持出中一覧には表示されません。VLM
          の学習ではなく、埋め込みギャラリーの母集団を増やす用途です（{' '}
          <code className="rounded bg-slate-100 px-1">PHOTO_TOOL_EMBEDDING_ENABLED</code> が有効なときギャラリーへ同期）。
        </p>
      </div>

      <Card title="新規登録">
        <form className="max-w-lg space-y-4" onSubmit={onSubmit}>
          <div>
            <label htmlFor="gallery-seed-image" className="mb-1 block text-sm font-medium text-slate-800">
              JPEG 画像
            </label>
            <input
              id="gallery-seed-image"
              name="image"
              type="file"
              accept="image/jpeg"
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm"
              onChange={(ev) => setFile(ev.target.files?.[0] ?? null)}
              disabled={mutation.isPending}
            />
          </div>
          <div>
            <label htmlFor="gallery-seed-label" className="mb-1 block text-sm font-medium text-slate-800">
              教師ラベル（表示名）
            </label>
            <input
              id="gallery-seed-label"
              name="canonicalLabel"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm"
              placeholder="例: ラジオペンチ"
              maxLength={200}
              disabled={mutation.isPending}
            />
            <p className="mt-1 text-xs text-slate-500">登録後も写真レビュー画面と同様に最大48文字へ正規化されます。</p>
          </div>
          <Button type="submit" disabled={mutation.isPending || !file || !label.trim()}>
            {mutation.isPending ? '登録中…' : '登録'}
          </Button>
          {mutation.isError && (
            <p className="text-sm text-red-600">登録に失敗しました。JPEG とラベルを確認してください。</p>
          )}
        </form>
      </Card>

      {lastLoanId && mutation.isSuccess && (
        <Card title="直近の登録結果">
          <p className="text-sm text-slate-800">
            貸出ID（ギャラリー用）: <code className="rounded bg-slate-100 px-1">{lastLoanId}</code>
          </p>
          <button
            type="button"
            className="mt-2 text-left text-sm text-sky-700 underline decoration-sky-600/60 hover:text-sky-900"
            onClick={() => setShowSimilar((v) => !v)}
          >
            {showSimilar ? '類似候補を隠す' : '類似候補を表示（管理・参考）'}
          </button>
          {showSimilar && (
            <Fragment>
              <p className="mb-2 mt-3 text-sm font-medium text-slate-800">類似候補</p>
              <SimilarCandidatesPanel loanId={lastLoanId} />
            </Fragment>
          )}
        </Card>
      )}
    </div>
  );
}
