import { useState } from 'react';

import { api , DEFAULT_CLIENT_KEY } from '../../api/client';
import { useActiveLoans, useReturnMutation, useCancelLoanMutation } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useLocalStorage } from '../../hooks/useLocalStorage';

import type { Loan, ReturnPayload } from '../../api/types';
import type { UseQueryResult } from '@tanstack/react-query';


interface KioskReturnPageProps {
  loansQuery?: UseQueryResult<Loan[], Error>;
  clientKey?: string;
}

export function KioskReturnPage({ loansQuery: providedLoansQuery, clientKey: providedClientKey }: KioskReturnPageProps = {}) {
  // propsでデータが提供されていない場合は自分で取得（/kiosk/returnルート用）
  const [localClientKey] = useLocalStorage('kiosk-client-key', DEFAULT_CLIENT_KEY);
  const resolvedClientKey = providedClientKey || localClientKey || DEFAULT_CLIENT_KEY;
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
    await returnMutation.mutateAsync(payload);
    await loansQuery.refetch();
  };

  const handleCancel = async (loanId: string) => {
    const payload = { loanId };
    await cancelMutation.mutateAsync(payload);
    await loansQuery.refetch();
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
          <p className="text-red-400">返却一覧の取得に失敗しました</p>
        ) : loansQuery.isLoading ? (
          <p>読み込み中...</p>
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
              const isInstrument = Boolean(loan.measuringInstrument);
              const isRigging = Boolean(loan.riggingGear);

              const baseCardClass = isOverdue
                ? 'border-red-500/50 bg-red-500/10'
                : isRigging
                  ? 'border-amber-400/50 bg-amber-300/20'
                  : isInstrument
                    ? 'border-indigo-400/40 bg-indigo-900/40'
                    : 'border-white/10 bg-white/5';

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
                      {isInstrument ? (
                        <>
                          <p className={`text-xs font-semibold truncate ${isOverdue ? 'text-red-300' : 'text-indigo-100'}`}>
                            {loan.measuringInstrument?.managementNumber ?? '管理番号なし'}
                          </p>
                          <p className={`text-sm font-semibold truncate ${isOverdue ? 'text-red-300' : 'text-white'}`}>
                            {loan.measuringInstrument?.name ?? '計測機器'}
                          </p>
                        </>
                      ) : isRigging ? (
                        <>
                          <p className={`text-xs font-semibold truncate ${isOverdue ? 'text-red-500' : 'text-amber-900'}`}>
                            {loan.riggingGear?.managementNumber ?? '管理番号なし'}
                          </p>
                          <p className={`text-sm font-semibold truncate ${isOverdue ? 'text-red-500' : 'text-amber-950'}`}>
                            {loan.riggingGear?.name ?? '吊具'}
                          </p>
                        </>
                      ) : (
                        <p className={`text-sm font-semibold truncate ${isOverdue ? 'text-red-400' : ''}`}>
                          {loan.item?.name ?? (
                            <span className="text-xs text-white/50">
                              {loan.photoUrl ? '写真撮影モード' : 'アイテム'}
                            </span>
                          )}
                        </p>
                      )}
                      <p className={`text-xs ${isOverdue ? 'text-red-300' : 'text-white/70'}`}>
                        {loan.employee?.displayName ?? '従業員情報なし'}
                      </p>
                      <p className={`text-xs ${isOverdue ? 'text-red-300' : 'text-white/50'}`}>
                        {borrowedAt.toLocaleString()}
                        {isOverdue && (
                          <span className="ml-2 font-semibold text-red-400">⚠ 期限超過</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 items-start md:items-end">
                    <Button
                      onClick={() => handleReturn(loan.id)}
                      disabled={returnMutation.isPending || cancelMutation.isPending}
                      className="text-xs px-3 py-1 h-auto"
                    >
                      {returnMutation.isPending ? '送信中…' : '返却'}
                    </Button>
                    <Button
                      onClick={() => handleCancel(loan.id)}
                      disabled={returnMutation.isPending || cancelMutation.isPending}
                      variant="ghost"
                      className="text-xs px-3 py-1 h-auto text-orange-400 hover:text-orange-300 hover:bg-orange-400/10"
                    >
                      {cancelMutation.isPending ? '取消中…' : '取消'}
                    </Button>
                  </div>
                </li>
              );
            })}
            </ul>
            {loansQuery.isFetching ? <p className="text-xs text-white/60">更新中...</p> : null}
          </div>
        ) : (
          <p>現在貸出中のアイテムはありません。</p>
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
