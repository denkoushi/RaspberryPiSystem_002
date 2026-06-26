import { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  useApproveSelfInspectionOutOfToleranceReview,
  useSelfInspectionOutOfToleranceReviews
} from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { kioskSelfInspectionSessionPath } from '../../features/part-measurement/selfInspectionRoutes';

function formatDateTime(raw: string | null): string {
  if (!raw) return '-';
  return new Date(raw).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

function readApiErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const message = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }
  return '承認処理に失敗しました。';
}

export function SelfInspectionOutOfToleranceReviewsPage() {
  const { user } = useAuth();
  const canApprove = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const reviewsQuery = useSelfInspectionOutOfToleranceReviews({ enabled: canApprove });
  const approveMutation = useApproveSelfInspectionOutOfToleranceReview();
  const [commentsBySessionId, setCommentsBySessionId] = useState<Record<string, string>>({});
  const [errorBySessionId, setErrorBySessionId] = useState<Record<string, string | null>>({});

  const approveSession = async (sessionId: string) => {
    setErrorBySessionId((prev) => ({ ...prev, [sessionId]: null }));
    try {
      await approveMutation.mutateAsync({
        sessionId,
        comment: commentsBySessionId[sessionId]?.trim() || null
      });
      setCommentsBySessionId((prev) => ({ ...prev, [sessionId]: '' }));
    } catch (error: unknown) {
      setErrorBySessionId((prev) => ({ ...prev, [sessionId]: readApiErrorMessage(error) }));
    }
  };

  if (!canApprove) {
    return (
      <div className="rounded border border-amber-300/40 bg-amber-300/10 p-4 text-amber-100">
        公差外レビューはADMINまたはMANAGERでログインしてください。
      </div>
    );
  }

  const sessions = reviewsQuery.data?.sessions ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">自主検査 公差外レビュー</h1>
        <p className="text-sm text-white/65">
          公差外の測定値を確認し、現場リーダー承認の証跡を残して自主検査を完了します。
        </p>
      </div>

      {reviewsQuery.isLoading ? (
        <div className="rounded border border-white/10 bg-slate-900/70 p-4 text-white/70">
          読み込み中...
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded border border-white/10 bg-slate-900/70 p-4 text-white/70">
          承認待ちの公差外測定値はありません。
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <section
              key={session.id}
              className="rounded border border-white/15 bg-slate-900/80 p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold">
                    {session.productNo} / {session.fhincd}
                  </h2>
                  <p className="text-sm text-white/65">
                    {session.fhinmei} / 資源 {session.resourceCd}
                    {session.fseiban ? ` / 製番 ${session.fseiban}` : ''}
                  </p>
                  <p className="text-xs text-white/50">
                    入力 {session.completedEntryCount}/{session.requiredEntryCount}件 / 承認待ち {session.pendingReviewCount}件
                  </p>
                </div>
                <Link
                  to={kioskSelfInspectionSessionPath(session.id)}
                  className="rounded border border-white/20 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10"
                >
                  入力画面を開く
                </Link>
              </div>

              <div className="mt-3 overflow-x-auto rounded border border-white/10">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-950/80 text-xs text-white/55">
                    <tr>
                      <th className="px-3 py-2">入力件</th>
                      <th className="px-3 py-2">丸数字</th>
                      <th className="px-3 py-2">測定</th>
                      <th className="px-3 py-2">値</th>
                      <th className="px-3 py-2">合格範囲</th>
                      <th className="px-3 py-2">確認時刻</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.values.map((value) => (
                      <tr key={value.id} className="border-t border-white/10">
                        <td className="px-3 py-2">{value.entrySlotLabel}</td>
                        <td className="px-3 py-2">{value.displayMarker ?? value.entryIndex + 1}</td>
                        <td className="px-3 py-2">
                          <div className="font-semibold">{value.measurementLabel}</div>
                          <div className="text-xs text-white/50">{value.measurementPoint}</div>
                        </td>
                        <td className="px-3 py-2 font-mono text-red-100">
                          {value.value}
                          {value.unit ? ` ${value.unit}` : ''}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {value.lowerLimit ?? '-'} - {value.upperLimit ?? '-'}
                        </td>
                        <td className="px-3 py-2">{formatDateTime(value.outOfToleranceAcknowledgedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                <textarea
                  value={commentsBySessionId[session.id] ?? ''}
                  onChange={(event) =>
                    setCommentsBySessionId((prev) => ({
                      ...prev,
                      [session.id]: event.target.value
                    }))
                  }
                  maxLength={500}
                  rows={2}
                  className="min-h-16 rounded border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                  placeholder="承認コメント（任意）"
                />
                <Button
                  type="button"
                  onClick={() => void approveSession(session.id)}
                  disabled={approveMutation.isPending}
                  className="min-w-40"
                >
                  承認して完了
                </Button>
              </div>
              {errorBySessionId[session.id] ? (
                <p className="mt-2 rounded border border-red-400/40 bg-red-500/15 px-3 py-2 text-sm text-red-100">
                  {errorBySessionId[session.id]}
                </p>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
