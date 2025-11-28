import { useState } from 'react';
import { useActiveLoans, useReturnMutation, useCancelLoanMutation } from '../../api/hooks';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { api } from '../../api/client';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Loan, ReturnPayload } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

interface KioskReturnPageProps {
  loansQuery?: UseQueryResult<Loan[], Error>;
  clientId?: string;
  clientKey?: string;
}

export function KioskReturnPage({ loansQuery: providedLoansQuery, clientId: providedClientId, clientKey: providedClientKey }: KioskReturnPageProps = {}) {
  // propsでデータが提供されていない場合は自分で取得（/kiosk/returnルート用）
  const [localClientKey] = useLocalStorage('kiosk-client-key', 'client-demo-key');
  const [localClientId] = useLocalStorage('kiosk-client-id', '');
  const resolvedClientKey = providedClientKey || localClientKey || 'client-demo-key';
  const resolvedClientId = providedClientId !== undefined ? providedClientId : (localClientId || undefined);
  
  // propsで提供されている場合はuseActiveLoansを呼び出さない（重複リクエストを防ぐ）
  // React Queryのenabledオプションを使用して、propsがない場合のみクエリを実行
  const ownLoansQuery = useActiveLoans(resolvedClientId, resolvedClientKey, {
    enabled: !providedLoansQuery // propsが提供されていない場合のみ有効化
  });
  
  // propsで提供されている場合はそれを使用、なければ自分で取得したものを使用
  const loansQuery = providedLoansQuery || ownLoansQuery;
  const returnMutation = useReturnMutation(resolvedClientKey);
  const cancelMutation = useCancelLoanMutation(resolvedClientKey);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);

  const handleReturn = async (loanId: string) => {
    // clientIdが空文字列の場合は送信しない
    const payload: ReturnPayload = {
      loanId
    };
    if (resolvedClientId && resolvedClientId.length > 0) {
      payload.clientId = resolvedClientId;
    }
    await returnMutation.mutateAsync(payload);
    await loansQuery.refetch();
  };

  const handleCancel = async (loanId: string) => {
    const payload = {
      loanId,
      ...(resolvedClientId && resolvedClientId.length > 0 ? { clientId: resolvedClientId } : {})
    };
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
    <Card title="返却一覧">
      {loansQuery.isError ? (
        <p className="text-red-400">返却一覧の取得に失敗しました</p>
      ) : loansQuery.isLoading ? (
        <p>読み込み中...</p>
      ) : loansQuery.data && loansQuery.data.length > 0 ? (
        <div className="space-y-4">
          <ul className="space-y-3">
            {loansQuery.data.map((loan) => {
              // 写真サムネイルのURLを生成
              const thumbnailUrl = loan.photoUrl
                ? loan.photoUrl.replace('/api/storage/photos', '/storage/thumbnails').replace('.jpg', '_thumb.jpg')
                : null;

              return (
                <li
                  key={loan.id}
                  className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex flex-1 gap-4">
                    {/* 写真サムネイル */}
                    {thumbnailUrl && (
                      <div className="flex-shrink-0">
                        <img
                          src={thumbnailUrl}
                          alt="撮影した写真"
                          className="h-20 w-20 rounded-lg object-cover border border-white/10 cursor-pointer hover:opacity-80"
                          onClick={() => loan.photoUrl && handleImageClick(loan.photoUrl)}
                          onError={(e) => {
                            // サムネイルが読み込めない場合は非表示
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                    {/* 貸出情報 */}
                    <div className="flex-1">
                      <p className="text-lg font-semibold">{loan.item?.name ?? 'アイテム情報なし'}</p>
                      <p className="text-sm text-white/70">{loan.employee?.displayName ?? '従業員情報なし'}</p>
                      <p className="text-xs text-white/50">借用: {new Date(loan.borrowedAt).toLocaleString()}</p>
                      {loan.photoTakenAt && (
                        <p className="text-xs text-white/50">撮影: {new Date(loan.photoTakenAt).toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 md:flex-row">
                    <Button
                      onClick={() => handleReturn(loan.id)}
                      disabled={returnMutation.isPending || cancelMutation.isPending}
                      className="md:min-w-[140px]"
                    >
                      {returnMutation.isPending ? '送信中…' : '返却する'}
                    </Button>
                    <Button
                      onClick={() => handleCancel(loan.id)}
                      disabled={returnMutation.isPending || cancelMutation.isPending}
                      variant="ghost"
                      className="md:min-w-[100px] text-orange-400 hover:text-orange-300 hover:bg-orange-400/10"
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
    </Card>
  );
}
