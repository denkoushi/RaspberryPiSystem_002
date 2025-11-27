import { useEffect, useRef, useState } from 'react';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useActiveLoans, useKioskConfig, usePhotoBorrowMutation } from '../../api/hooks';
import { useNfcStream } from '../../hooks/useNfcStream';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { KioskReturnPage } from './KioskReturnPage';
import { setClientKeyHeader } from '../../api/client';
import type { Loan } from '../../api/types';

export function KioskPhotoBorrowPage() {
  const { data: config } = useKioskConfig();
  const [clientKey, setClientKey] = useLocalStorage('kiosk-client-key', 'client-demo-key');
  const [clientId, setClientId] = useLocalStorage('kiosk-client-id', '');
  const resolvedClientKey = clientKey || 'client-demo-key';
  const resolvedClientId = clientId || undefined;
  const loansQuery = useActiveLoans(resolvedClientId, resolvedClientKey);
  const photoBorrowMutation = usePhotoBorrowMutation(resolvedClientKey);
  const nfcEvent = useNfcStream();
  const lastEventKeyRef = useRef<string | null>(null);

  const [employeeTagUid, setEmployeeTagUid] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successLoan, setSuccessLoan] = useState<Loan | null>(null);
  const pageMountedRef = useRef(false);

  // client-key が空になってもデフォルトを自動で復元する
  useEffect(() => {
    if (!clientKey) {
      setClientKey('client-demo-key');
      setClientKeyHeader('client-demo-key');
    } else {
      setClientKeyHeader(clientKey);
    }
  }, [clientKey, setClientKey]);

  // ページマウント後にマウントフラグを設定（古いNFCイベントを無視するため）
  useEffect(() => {
    // ページマウント後、500ms待ってからNFCイベントを受け付ける
    const timer = setTimeout(() => {
      pageMountedRef.current = true;
      lastEventKeyRef.current = null; // マウント前のイベントをクリア
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // NFCイベントの処理
  useEffect(() => {
    // ページマウント前、または処理中、またはNFCイベントがない場合はスキップ
    if (!pageMountedRef.current || !nfcEvent || isCapturing) return;
    
    const eventKey = `${nfcEvent.uid}:${nfcEvent.timestamp}`;
    if (lastEventKeyRef.current === eventKey) {
      return; // 重複イベントを無視
    }

    // 従業員タグをスキャンしたら、すぐに撮影＋持出処理を開始
    setEmployeeTagUid(nfcEvent.uid);
    setIsCapturing(true);
    setError(null);
    setSuccessLoan(null);
    lastEventKeyRef.current = eventKey;

    // APIを呼び出して撮影＋持出
    photoBorrowMutation.mutate(
      {
        employeeTagUid: nfcEvent.uid,
        clientId: resolvedClientId || undefined,
      },
      {
        onSuccess: (loan) => {
          setIsCapturing(false);
          setSuccessLoan(loan);
          // 3秒後にリセット
          setTimeout(() => {
            setEmployeeTagUid(null);
            setSuccessLoan(null);
            lastEventKeyRef.current = null;
          }, 3000);
        },
        onError: (error: any) => {
          setIsCapturing(false);
          const apiMessage: string | undefined = error?.response?.data?.message;
          const message = typeof apiMessage === 'string' && apiMessage.length > 0 ? apiMessage : error?.message;
          setError(message ?? '写真の撮影に失敗しました');
          // エラー時はすぐにリセット可能にする
        },
      }
    );
  }, [nfcEvent, isCapturing, photoBorrowMutation, resolvedClientId]);

  // ページアンマウント時に状態をリセット
  useEffect(() => {
    return () => {
      pageMountedRef.current = false;
      lastEventKeyRef.current = null;
    };
  }, []);

  const handleReset = () => {
    setEmployeeTagUid(null);
    setIsCapturing(false);
    setError(null);
    setSuccessLoan(null);
    lastEventKeyRef.current = null;
  };

  return (
    <div className="space-y-6">
      <Card title="ステーション設定">
        <div className="grid gap-4 md:grid-cols-2 lg:w-1/2">
          <label className="block text-sm text-white/70">
            クライアント API キー
            <Input value={clientKey} onChange={(e) => setClientKey(e.target.value)} placeholder="client-demo-key" />
          </label>
          <label className="block text-sm text-white/70">
            クライアントID（任意）
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="UUID (任意)" />
          </label>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="写真撮影持出">
          <div className="space-y-4 text-center">
            <p className="text-3xl font-semibold">
              {config?.greeting ?? 'Itemをカメラの前に置いて、従業員タグをスキャンしてください'}
            </p>
            
            {/* 撮影中の表示 */}
            {isCapturing && (
              <div className="rounded-lg bg-blue-600/20 p-4">
                <p className="text-lg font-semibold text-blue-300">写真を撮影中...</p>
                <p className="mt-2 text-sm text-white/70">しばらくお待ちください</p>
              </div>
            )}

            {/* 従業員タグスキャン済みの表示 */}
            {employeeTagUid && !isCapturing && !successLoan && !error && (
              <div className="rounded-lg border border-white/10 p-4">
                <p className="text-sm text-white/70">従業員タグ</p>
                <p className="mt-2 text-xl font-bold">{employeeTagUid}</p>
              </div>
            )}

            {/* エラー表示 */}
            {error && (
              <div className="rounded-lg bg-red-600/20 p-4 text-left">
                <p className="text-lg font-semibold text-red-300">エラー</p>
                <p className="mt-2 text-sm text-white/70">{error}</p>
              </div>
            )}

            {/* 成功表示 */}
            {successLoan && (
              <div className="rounded-lg bg-emerald-600/20 p-4 text-left">
                <p className="text-lg font-semibold text-emerald-300">登録完了</p>
                <p className="mt-2 text-sm text-white/70">
                  {successLoan.employee.displayName} さんが持出を記録しました
                </p>
                {successLoan.photoUrl && (
                  <div className="mt-4">
                    <img
                      src={successLoan.photoUrl.replace('/api/storage/photos', '/storage/thumbnails').replace('.jpg', '_thumb.jpg')}
                      alt="撮影した写真"
                      className="mx-auto h-32 w-32 rounded-lg object-cover"
                      onError={(e) => {
                        // サムネイルが読み込めない場合は非表示
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* リセットボタン */}
            {(employeeTagUid || error || successLoan) && (
              <div className="flex justify-center gap-4">
                <Button onClick={handleReset} disabled={isCapturing}>
                  リセット
                </Button>
              </div>
            )}
          </div>
        </Card>

        <KioskReturnPage loansQuery={loansQuery} clientId={resolvedClientId} clientKey={resolvedClientKey} />
      </div>
    </div>
  );
}

