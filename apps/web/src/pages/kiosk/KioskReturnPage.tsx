import { useState } from 'react';
import { useActiveLoans, useReturnMutation } from '../../api/hooks';
import { useLocalStorage } from '../../hooks/useLocalStorage';
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
  const [note, setNote] = useState('');
  const returnMutation = useReturnMutation(resolvedClientKey);

  const handleReturn = async (loanId: string) => {
    // clientIdが空文字列の場合は送信しない
    const payload: ReturnPayload = {
      loanId,
      note: note || undefined
    };
    if (resolvedClientId && resolvedClientId.length > 0) {
      payload.clientId = resolvedClientId;
    }
    await returnMutation.mutateAsync(payload);
    await loansQuery.refetch();
    setNote('');
  };

  return (
    <Card title="返却一覧">
      {loansQuery.isError ? (
        <p className="text-red-400">返却一覧の取得に失敗しました</p>
      ) : loansQuery.isLoading ? (
        <p>読み込み中...</p>
      ) : loansQuery.data && loansQuery.data.length > 0 ? (
        <div className="space-y-4">
          <label className="block text-sm text-white/70">
            備考（任意）
            <textarea
              className="mt-1 w-full rounded-md border border-white/10 bg-white/5 p-3 text-white"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
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
                          className="h-20 w-20 rounded-lg object-cover border border-white/10"
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
                  <Button
                    onClick={() => handleReturn(loan.id)}
                    disabled={returnMutation.isPending}
                    className="md:min-w-[140px]"
                  >
                    {returnMutation.isPending ? '送信中…' : '返却する'}
                  </Button>
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
  );
}
