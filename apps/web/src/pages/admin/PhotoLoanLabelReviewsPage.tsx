import {
  PHOTO_LOAN_CARD_PRIMARY_LABEL,
  resolvePhotoLoanToolDisplayLabel,
} from '@raspi-system/shared-types';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { usePatchPhotoLabelReview, usePhotoLabelReviews } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../../contexts/AuthContext';

import type { PhotoLabelReviewItem, PhotoLabelReviewQuality } from '../../api/client';

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

function ReviewRow({ item }: { item: PhotoLabelReviewItem }) {
  const patch = usePatchPhotoLabelReview();
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
        {patch.isError && <p className="mt-1 text-xs text-red-600">保存に失敗しました</p>}
      </td>
    </tr>
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
