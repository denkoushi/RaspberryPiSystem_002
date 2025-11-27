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
  const processedUidsRef = useRef<Map<string, number>>(new Map()); // 処理済みUIDとタイムスタンプのマップ

  const [employeeTagUid, setEmployeeTagUid] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successLoan, setSuccessLoan] = useState<Loan | null>(null);
  const pageMountedRef = useRef(false);
  const processingRef = useRef(false); // 処理中フラグ（重複処理を防ぐ）

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
      processedUidsRef.current.clear(); // 処理済みUIDリストをクリア
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // 処理済みUIDのクリーンアップ（10秒以上古いエントリを削除）
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const processedUids = processedUidsRef.current;
      for (const [uid, timestamp] of processedUids.entries()) {
        if (now - timestamp > 10000) {
          // 10秒以上古いエントリを削除
          processedUids.delete(uid);
        }
      }
    }, 1000); // 1秒ごとにクリーンアップ

    return () => clearInterval(cleanupInterval);
  }, []);

  // NFCイベントの処理
  useEffect(() => {
    // ページマウント前、または処理中、またはNFCイベントがない場合はスキップ
    if (!pageMountedRef.current || !nfcEvent || isCapturing || processingRef.current) return;
    
    const eventKey = `${nfcEvent.uid}:${nfcEvent.timestamp}`;
    const now = Date.now();
    const processedUids = processedUidsRef.current;
    
    // デバッグログの出力制御（環境変数で制御可能、デフォルトは開発中は常に出力）
    const enableDebugLogs = import.meta.env.VITE_ENABLE_DEBUG_LOGS !== 'false';
    
    // 同じeventKeyを既に処理済みの場合はスキップ
    if (lastEventKeyRef.current === eventKey) {
      if (enableDebugLogs) {
        console.log('[KioskPhotoBorrowPage] Skipping duplicate event:', eventKey);
      }
      return;
    }
    
    // 同じUIDが10秒以内に処理済みの場合はスキップ
    const lastProcessedTime = processedUids.get(nfcEvent.uid);
    if (lastProcessedTime && now - lastProcessedTime < 10000) {
      if (enableDebugLogs) {
        console.log('[KioskPhotoBorrowPage] Skipping recently processed UID:', nfcEvent.uid, 'last processed:', lastProcessedTime);
      }
      return;
    }

    // 処理中フラグを立てる（重複処理を防ぐ）
    processingRef.current = true;
    lastEventKeyRef.current = eventKey;
    processedUids.set(nfcEvent.uid, now); // 処理済みUIDを記録

    if (enableDebugLogs) {
      console.log('[KioskPhotoBorrowPage] Processing NFC event:', nfcEvent.uid, 'eventKey:', eventKey);
    }

    // 従業員タグをスキャンしたら、すぐに撮影＋持出処理を開始
    const currentUid = nfcEvent.uid; // クロージャで値を保持
    setEmployeeTagUid(currentUid);
    setIsCapturing(true);
    setError(null);
    setSuccessLoan(null);

    // APIを呼び出して撮影＋持出
    photoBorrowMutation.mutate(
      {
        employeeTagUid: currentUid,
        clientId: resolvedClientId || undefined,
      },
      {
        onSuccess: (loan) => {
          setIsCapturing(false);
          setSuccessLoan(loan);
          // デバッグログの出力制御（環境変数で制御可能、デフォルトは開発中は常に出力）
          const enableDebugLogs = import.meta.env.VITE_ENABLE_DEBUG_LOGS !== 'false';
          if (enableDebugLogs) {
            console.log('[KioskPhotoBorrowPage] Photo borrow success:', loan.id);
          }
          // 5秒後にリセット（処理中フラグもリセット）
          setTimeout(() => {
            setEmployeeTagUid(null);
            setSuccessLoan(null);
            // eventKeyはリセットしない（同じイベントを再度処理しないため）
            processingRef.current = false;
          }, 5000);
        },
        onError: (error: any) => {
          setIsCapturing(false);
          const apiMessage: string | undefined = error?.response?.data?.message;
          const message = typeof apiMessage === 'string' && apiMessage.length > 0 ? apiMessage : error?.message;
          setError(message ?? '写真の撮影に失敗しました');
          // エラーログは本番環境でも出力（問題の特定に必要）
          console.error('[KioskPhotoBorrowPage] Photo borrow error:', error);
          // エラー時は3秒後にリセット可能にする（処理中フラグもリセット）
          // eventKeyはリセットしない（同じイベントを再度処理しないため）
          setTimeout(() => {
            processingRef.current = false;
          }, 3000);
        },
      }
    );
  }, [nfcEvent?.uid, nfcEvent?.timestamp, isCapturing, photoBorrowMutation, resolvedClientId]);

  // ページアンマウント時に状態をリセット
  useEffect(() => {
    return () => {
      pageMountedRef.current = false;
      lastEventKeyRef.current = null;
      processingRef.current = false;
      processedUidsRef.current.clear();
    };
  }, []);

  const handleReset = () => {
    setEmployeeTagUid(null);
    setIsCapturing(false);
    setError(null);
    setSuccessLoan(null);
    lastEventKeyRef.current = null;
    processingRef.current = false; // 処理中フラグもリセット
    // 処理済みUIDリストはクリアしない（意図的なリセットの場合のみ）
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
              Itemをカメラの前に置いて、従業員タグをスキャンしてください
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

