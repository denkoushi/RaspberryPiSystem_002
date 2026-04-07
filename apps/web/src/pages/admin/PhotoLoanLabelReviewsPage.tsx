import {
  PHOTO_LOAN_CARD_PRIMARY_LABEL,
  PHOTO_TOOL_VLM_LABEL_PROVENANCE,
  resolvePhotoLoanToolDisplayLabel,
  type PhotoToolVlmLabelProvenance,
} from '@raspi-system/shared-types';
import { Fragment, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { usePatchPhotoLabelReview, usePhotoLabelReviews, usePhotoSimilarCandidates } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../../contexts/AuthContext';

import type { PhotoLabelReviewItem, PhotoLabelReviewQuality } from '../../api/client';

function vlmProvenanceLabel(p: PhotoToolVlmLabelProvenance): string {
  if (p === PHOTO_TOOL_VLM_LABEL_PROVENANCE.UNKNOWN) return '記録なし(旧)';
  if (p === PHOTO_TOOL_VLM_LABEL_PROVENANCE.FIRST_PASS_VLM) return '初回VLM';
  if (p === PHOTO_TOOL_VLM_LABEL_PROVENANCE.ASSIST_ACTIVE_VLM) return '補助・2回目VLM';
  if (p === PHOTO_TOOL_VLM_LABEL_PROVENANCE.ASSIST_ACTIVE_CONVERGED) return '補助・収束採用';
  return '補助採用';
}

function qualityLabel(q: PhotoLabelReviewQuality | null): string {
  if (q === 'GOOD') return '良い';
  if (q === 'MARGINAL') return '微妙';
  if (q === 'BAD') return '悪い';
  return '—';
}

function toThumbnailUrl(photoUrl: string): string {
  if (!photoUrl.startsWith('/api/storage/photos/')) {
    return photoUrl;
  }
  return photoUrl
    .replace('/api/storage/photos/', '/storage/thumbnails/')
    .replace(/\.jpg$/, '_thumb.jpg');
}

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
        類似候補はありません（埋め込み無効・閾値・ギャラリー未登録のいずれかの可能性があります）。
      </p>
    );
  }
  return (
    <ul className="list-inside list-disc space-y-1 text-slate-800">
      {data.map((c) => (
        <li key={c.sourceLoanId}>
          <span className="font-medium">{c.canonicalLabel}</span>
          <span className="ml-2 text-slate-600">
            （貸出 {c.sourceLoanId.slice(0, 8)}… / score {c.score.toFixed(3)}）
          </span>
        </li>
      ))}
    </ul>
  );
}

function ReviewRow({ item }: { item: PhotoLabelReviewItem }) {
  const patch = usePatchPhotoLabelReview();
  const [showSimilar, setShowSimilar] = useState(false);
  const [quality, setQuality] = useState<PhotoLabelReviewQuality>(item.photoToolHumanQuality ?? 'GOOD');
  const [humanName, setHumanName] = useState(item.photoToolHumanDisplayName ?? '');

  useEffect(() => {
    setQuality(item.photoToolHumanQuality ?? 'GOOD');
    setHumanName(item.photoToolHumanDisplayName ?? '');
  }, [item]);

  const resolved = resolvePhotoLoanToolDisplayLabel({
    humanDisplayName: item.photoToolHumanDisplayName,
    vlmDisplayName: item.photoToolDisplayName,
    fallbackLabel: PHOTO_LOAN_CARD_PRIMARY_LABEL,
  });

  return (
    <Fragment>
    <tr className="border-b border-slate-200 align-top text-slate-900">
      <td className="py-3 pr-2">
        <img
          src={toThumbnailUrl(item.photoUrl)}
          alt="写真持出サムネイル"
          className="h-20 w-20 rounded object-cover bg-slate-100"
          loading="lazy"
        />
      </td>
      <td className="py-3 pr-2 text-sm">
        <div className="font-medium">{item.employee.displayName}</div>
        <div className="text-slate-600">{item.employee.employeeCode}</div>
        <div className="text-xs text-slate-500">
          {item.client?.name ?? '—'} / {item.client?.location ?? '—'}
        </div>
      </td>
      <td className="py-3 pr-2 text-sm">
        <div>VLM: {item.photoToolDisplayName ?? '—'}</div>
        <div className="mt-1">
          <span
            className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700"
            title="DB に保存された VLM 列の出自（人による上書きとは別）"
          >
            VLM出自: {vlmProvenanceLabel(item.photoToolVlmLabelProvenance)}
          </span>
        </div>
        <div className="text-slate-600">表示: {resolved}</div>
      </td>
      <td className="py-3 pr-2 text-sm">
        <div className="mb-1">記録: {qualityLabel(item.photoToolHumanQuality)}</div>
        <select
          className="w-full rounded border border-slate-400 bg-white px-2 py-1 text-sm"
          value={quality}
          onChange={(e) => setQuality(e.target.value as PhotoLabelReviewQuality)}
        >
          <option value="GOOD">良い</option>
          <option value="MARGINAL">微妙</option>
          <option value="BAD">悪い</option>
        </select>
      </td>
      <td className="py-3 pr-2">
        <input
          type="text"
          className="w-full min-w-[8rem] rounded border border-slate-400 px-2 py-1 text-sm"
          placeholder="人による表示名（空でクリア）"
          value={humanName}
          onChange={(e) => setHumanName(e.target.value)}
        />
      </td>
      <td className="py-3 pr-0">
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            type="button"
            disabled={patch.isPending}
            onClick={() =>
              patch.mutate({
                loanId: item.id,
                quality,
                humanDisplayName: humanName.trim() === '' ? null : humanName.trim(),
              })
            }
          >
            {patch.isPending ? '保存中…' : '保存'}
          </Button>
          <button
            type="button"
            className="text-left text-xs text-sky-700 underline decoration-sky-600/60 hover:text-sky-900"
            onClick={() => setShowSimilar((v) => !v)}
          >
            {showSimilar ? '類似候補を隠す' : '類似候補を表示'}
          </button>
        </div>
        {patch.isError && <p className="mt-1 text-xs text-red-600">保存に失敗しました</p>}
      </td>
    </tr>
    {showSimilar && (
      <tr className="border-b border-slate-200 bg-slate-50 align-top">
        <td colSpan={6} className="py-3 pr-2 pl-4 text-sm">
          <p className="mb-2 font-medium text-slate-800">類似候補（GOOD ギャラリー・参考表示のみ）</p>
          <SimilarCandidatesPanel loanId={item.id} />
        </td>
      </tr>
    )}
    </Fragment>
  );
}

export function PhotoLoanLabelReviewsPage() {
  const { user } = useAuth();
  const { data, isLoading, isError } = usePhotoLabelReviews(50);

  if (!user) {
    return null;
  }

  if (user.role === 'VIEWER') {
    return <Navigate to="/admin" replace />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">写真持出 VLM ラベル確認</h1>
        <p className="mt-1 text-sm text-slate-600">
          直近の写真持出について、VLM 表示名の品質を記録し、必要に応じて表示名を上書きできます（管理者・マネージャーのみ）。
          キオスク・サイネージは <strong>人による上書き &gt; VLM &gt; 撮影mode</strong> の順で表示します。
          行の「VLM出自」バッジは、DB に保存された <strong>VLM 列が最後のジョブでどう確定したか</strong>のみを示し、人による上書きとは別です。
          行の「類似候補」は管理画面のみの参考表示で、現場の確定ラベルは変わりません。
        </p>
      </div>

      <Card title="一覧（最大50件・貸出日降順）">
        {isLoading && <p className="text-slate-600">読み込み中…</p>}
        {isError && <p className="text-red-600">読み込みに失敗しました。</p>}
        {data && data.length === 0 && <p className="text-slate-600">対象の貸出がありません。</p>}
        {data && data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-slate-700">
                  <th className="pb-2 pr-2 font-semibold">写真</th>
                  <th className="pb-2 pr-2 font-semibold">社員・端末</th>
                  <th className="pb-2 pr-2 font-semibold">ラベル</th>
                  <th className="pb-2 pr-2 font-semibold">品質</th>
                  <th className="pb-2 pr-2 font-semibold">上書き表示名</th>
                  <th className="pb-2 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.map((item) => (
                  <ReviewRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
