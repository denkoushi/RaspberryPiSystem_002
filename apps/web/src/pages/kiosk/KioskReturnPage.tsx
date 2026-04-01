import { useEffect, useState } from 'react';

import { api, getResolvedClientKey, postClientLogs } from '../../api/client';
import { useActiveLoans, useReturnMutation, useCancelLoanMutation } from '../../api/hooks';
import { KioskActiveLoanCard } from '../../components/kiosk/KioskActiveLoanCard';
import { Card } from '../../components/ui/Card';
import { presentActiveLoanListLines } from '../../features/kiosk/activeLoanListLines';

import type { Loan, ReturnPayload } from '../../api/types';
import type { UseQueryResult } from '@tanstack/react-query';
import type { AxiosError } from 'axios';


interface KioskReturnPageProps {
  loansQuery?: UseQueryResult<Loan[], Error>;
  clientKey?: string;
}

export function KioskReturnPage({ loansQuery: providedLoansQuery, clientKey: providedClientKey }: KioskReturnPageProps = {}) {
  // propsでデータが提供されていない場合は自分で取得（/kiosk/returnルート用）
  const resolvedClientKey = providedClientKey || getResolvedClientKey();
  const resolvedClientId = undefined;
  // 返却一覧は全件表示（clientIdで絞らない）

  // propsで提供されている場合はuseActiveLoansを呼び出さない（重複リクエストを防ぐ）
  // React Queryのenabledオプションを使用して、propsがない場合のみクエリを実行
  const ownLoansQuery = useActiveLoans(undefined, resolvedClientKey, {
    enabled: !providedLoansQuery // propsが提供されていない場合のみ有効化
  });

  // propsで提供されている場合はそれを使用、なければ自分で取得したものを使用
  const loansQuery = providedLoansQuery || ownLoansQuery;
  const returnMutation = useReturnMutation(resolvedClientKey);
  const cancelMutation = useCancelLoanMutation(resolvedClientKey);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (selectedImageUrl) {
        URL.revokeObjectURL(selectedImageUrl);
      }
    };
  }, [selectedImageUrl]);

  const handleReturn = async (loanId: string) => {
    const payload: ReturnPayload = { loanId };
    try {
      await returnMutation.mutateAsync(payload);
      await loansQuery.refetch();
    } catch (error) {
      const apiErr = error as Partial<AxiosError<{ message?: string }>>;
      const apiMessage: string | undefined = apiErr.response?.data?.message;
      const errorMessage = apiMessage || apiErr?.message || '返却に失敗しました';

      // エラーログをサーバーに送信
      postClientLogs(
        {
          clientId: resolvedClientId || 'raspberrypi4-kiosk1',
          logs: [
            {
              level: 'ERROR',
              message: `kiosk-return failed: ${errorMessage}`,
              context: {
                loanId,
                error: {
                  message: apiErr?.message,
                  status: apiErr?.response?.status,
                  apiMessage
                }
              }
            }
          ]
        },
        resolvedClientKey
      ).catch(() => {
        /* noop - ログ送信失敗は無視 */
      });

      alert(`返却に失敗しました: ${errorMessage}`);
    }
  };

  const handleCancel = async (loanId: string) => {
    const payload = { loanId };
    try {
      await cancelMutation.mutateAsync(payload);
      await loansQuery.refetch();
    } catch (error) {
      const apiErr = error as Partial<AxiosError<{ message?: string }>>;
      const apiMessage: string | undefined = apiErr.response?.data?.message;
      const errorMessage = apiMessage || apiErr?.message || '取消に失敗しました';

      // エラーログをサーバーに送信
      postClientLogs(
        {
          clientId: resolvedClientId || 'raspberrypi4-kiosk1',
          logs: [
            {
              level: 'ERROR',
              message: `kiosk-cancel failed: ${errorMessage}`,
              context: {
                loanId,
                error: {
                  message: apiErr?.message,
                  status: apiErr?.response?.status,
                  apiMessage
                }
              }
            }
          ]
        },
        resolvedClientKey
      ).catch(() => {
        /* noop - ログ送信失敗は無視 */
      });

      alert(`取消に失敗しました: ${errorMessage}`);
    }
  };

  const handleImageClick = async (photoUrl: string) => {
    try {
      // photoUrlは /api/storage/photos/... 形式なので、/api を除いて /storage/photos/... にする
      const imagePath = photoUrl.replace(/^\/api/, '');
      const response = await api.get(imagePath, {
        responseType: 'blob',
      });
      const blobUrl = URL.createObjectURL(response.data);
      setSelectedImageUrl((previousUrl) => {
        if (previousUrl) {
          URL.revokeObjectURL(previousUrl);
        }
        return blobUrl;
      });
    } catch (error) {
      console.error('画像の取得に失敗しました:', error);
      alert('画像の取得に失敗しました');
    }
  };

  const actionsDisabled = returnMutation.isPending || cancelMutation.isPending;
  const returnButtonLabel = returnMutation.isPending ? '送信中…' : '返却';
  const cancelButtonLabel = cancelMutation.isPending ? '取消中…' : '取消';
  const closeImageModal = () => {
    if (selectedImageUrl) {
      URL.revokeObjectURL(selectedImageUrl);
    }
    setSelectedImageUrl(null);
  };

  return (
    <div className="h-full flex flex-col">
      <Card title="持出一覧" className="h-full flex flex-col">
        {loansQuery.isError ? (
          <p className="text-sm font-semibold text-red-400">返却一覧の取得に失敗しました</p>
        ) : loansQuery.isLoading ? (
          <p className="text-sm text-slate-200">読み込み中...</p>
        ) : loansQuery.data && loansQuery.data.length > 0 ? (
          <div className="flex-1 overflow-y-auto min-h-0 -mx-4 px-4">
            <ul className="grid grid-cols-5 gap-2">
              {loansQuery.data.map((loan) => {
                const thumbnailUrl = loan.photoUrl
                  ? loan.photoUrl.replace('/api/storage/photos', '/storage/thumbnails').replace('.jpg', '_thumb.jpg')
                  : null;

                const borrowedAt = new Date(loan.borrowedAt);
                const dueAt = loan.dueAt ? new Date(loan.dueAt) : new Date(borrowedAt.getTime() + 12 * 60 * 60 * 1000);
                const isOverdue = new Date() > dueAt;
                const presentation = presentActiveLoanListLines(loan);

                return (
                  <KioskActiveLoanCard
                    key={loan.id}
                    presentation={presentation}
                    thumbnailUrl={thumbnailUrl}
                    photoUrl={loan.photoUrl}
                    isOverdue={isOverdue}
                    employeeDisplayName={loan.employee?.displayName ?? '従業員情報なし'}
                    borrowedAtDisplay={borrowedAt.toLocaleString()}
                    returnButtonLabel={returnButtonLabel}
                    cancelButtonLabel={cancelButtonLabel}
                    actionsDisabled={actionsDisabled}
                    onReturn={() => handleReturn(loan.id)}
                    onCancel={() => handleCancel(loan.id)}
                    onThumbnailClick={handleImageClick}
                  />
                );
              })}
            </ul>
            {loansQuery.isFetching ? <p className="text-sm text-white/80">更新中...</p> : null}
          </div>
        ) : (
          <p className="text-sm text-slate-200">現在貸出中のアイテムはありません。</p>
        )}
      </Card>

      {/* 画像モーダル */}
      {selectedImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={closeImageModal}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]">
            <img
              src={selectedImageUrl}
              alt="撮影した写真"
              className="max-h-[90vh] max-w-[90vw] rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              className="absolute right-2 top-2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              onClick={closeImageModal}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
