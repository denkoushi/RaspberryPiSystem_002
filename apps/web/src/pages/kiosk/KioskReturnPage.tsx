import { useState } from 'react';

import { api, getResolvedClientKey, postClientLogs } from '../../api/client';
import { useActiveLoans, useReturnMutation, useCancelLoanMutation } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
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
      setSelectedImageUrl(blobUrl);
    } catch (error) {
      console.error('画像の取得に失敗しました:', error);
      alert('画像の取得に失敗しました');
    }
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
              // 写真サムネイルのURLを生成
              const thumbnailUrl = loan.photoUrl
                ? loan.photoUrl.replace('/api/storage/photos', '/storage/thumbnails').replace('.jpg', '_thumb.jpg')
                : null;

              // 12時間経過チェック: dueAtがあればそれを使用、なければborrowedAtから12時間後を計算
              const borrowedAt = new Date(loan.borrowedAt);
              const dueAt = loan.dueAt ? new Date(loan.dueAt) : new Date(borrowedAt.getTime() + 12 * 60 * 60 * 1000);
              const isOverdue = new Date() > dueAt;
              const presentation = presentActiveLoanListLines(loan);

              const baseCardClass = isOverdue
                ? 'border-2 border-red-700 bg-red-600 text-white shadow-lg'
                : presentation.kind === 'rigging'
                  ? 'border-2 border-orange-700 bg-orange-500 text-white shadow-lg'
                  : presentation.kind === 'instrument'
                    ? 'border-2 border-purple-800 bg-purple-600 text-white shadow-lg'
                    : 'border-2 border-blue-700 bg-blue-500 text-white shadow-lg';

              return (
                <li
                  key={loan.id}
                  className={`flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between ${baseCardClass}`}
                >
                  <div className="flex flex-1 gap-3">
                    {/* 写真サムネイル */}
                    {thumbnailUrl && (
                      <div className="flex-shrink-0">
                        <img
                          src={thumbnailUrl}
                          alt="撮影した写真"
                          className="h-[72px] w-[72px] rounded object-cover border border-white/10 cursor-pointer hover:opacity-80"
                          onClick={() => loan.photoUrl && handleImageClick(loan.photoUrl)}
                          onError={(e) => {
                            // サムネイルが読み込めない場合は非表示
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                    {/* 貸出情報 */}
                    <div className="flex-1 min-w-0">
                      {presentation.kind === 'instrument' ? (
                        <>
                          <div className="mb-1">
                            <p className={`text-sm font-bold truncate ${isOverdue ? 'text-red-200' : 'text-white'}`}>
                              {presentation.primaryLine}
                            </p>
                          </div>
                          <p className={`text-base font-bold truncate ${isOverdue ? 'text-red-200' : 'text-white'}`}>
                            {presentation.nameLine}
                          </p>
                        </>
                      ) : presentation.kind === 'rigging' ? (
                        <>
                          <div className="mb-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <p
                              className={`min-w-0 flex-1 text-sm font-bold truncate ${isOverdue ? 'text-red-200' : 'text-white'}`}
                            >
                              {presentation.primaryLine}
                            </p>
                            {presentation.idNumLine != null ? (
                              <span
                                className={`shrink-0 text-xs font-semibold ${isOverdue ? 'text-red-200' : 'text-white/85'}`}
                              >
                                {presentation.idNumLine}
                              </span>
                            ) : null}
                          </div>
                          <p className={`text-base font-bold truncate ${isOverdue ? 'text-red-200' : 'text-white'}`}>
                            {presentation.nameLine}
                          </p>
                        </>
                      ) : (
                        <p className={`text-base font-bold truncate ${isOverdue ? 'text-red-200' : 'text-white'}`}>{presentation.primaryLine}</p>
                      )}
                      <p className={`text-sm font-semibold mt-1 ${isOverdue ? 'text-red-200' : 'text-white/95'}`}>
                        {loan.employee?.displayName ?? '従業員情報なし'}
                      </p>
                      <p className={`text-sm mt-1 ${isOverdue ? 'text-red-200' : 'text-white/90'}`}>
                        {presentation.clientLocationLine}
                      </p>
                      <p className={`text-sm mt-1 ${isOverdue ? 'text-red-200' : 'text-white/90'}`}>
                        {borrowedAt.toLocaleString()}
                        {isOverdue && (
                          <span className="ml-2 font-bold text-red-200">⚠ 期限超過</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 items-start md:items-end">
                    <Button
                      onClick={() => handleReturn(loan.id)}
                      disabled={returnMutation.isPending || cancelMutation.isPending}
                      className="text-sm font-semibold px-3 py-1 h-auto"
                    >
                      {returnMutation.isPending ? '送信中…' : '返却'}
                    </Button>
                    <Button
                      onClick={() => handleCancel(loan.id)}
                      disabled={returnMutation.isPending || cancelMutation.isPending}
                      variant="ghost"
                      className="text-sm font-semibold px-3 py-1 h-auto text-white/90 hover:text-white hover:bg-white/20"
                    >
                      {cancelMutation.isPending ? '取消中…' : '取消'}
                    </Button>
                  </div>
                </li>
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
          onClick={() => {
            URL.revokeObjectURL(selectedImageUrl);
            setSelectedImageUrl(null);
          }}
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
              onClick={() => {
                URL.revokeObjectURL(selectedImageUrl);
                setSelectedImageUrl(null);
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
