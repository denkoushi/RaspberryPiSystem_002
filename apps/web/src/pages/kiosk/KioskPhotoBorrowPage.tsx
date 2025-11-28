import { useEffect, useRef, useState } from 'react';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useActiveLoans, useKioskConfig, usePhotoBorrowMutation } from '../../api/hooks';
import { useNfcStream } from '../../hooks/useNfcStream';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { KioskReturnPage } from './KioskReturnPage';
import type { Loan } from '../../api/types';
import { captureAndCompressPhoto } from '../../utils/camera';

export function KioskPhotoBorrowPage() {
  const { data: config } = useKioskConfig();
  const [clientKey] = useLocalStorage('kiosk-client-key', 'client-demo-key');
  const [clientId] = useLocalStorage('kiosk-client-id', '');
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


  // 処理済みUIDのクリーンアップ（3秒以上古いエントリを削除）
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const processedUids = processedUidsRef.current;
      for (const [uid, timestamp] of processedUids.entries()) {
        if (now - timestamp > 3000) {
          // 3秒以上古いエントリを削除
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
    
    // 同じUIDが3秒以内に処理済みの場合はスキップ
    const lastProcessedTime = processedUids.get(nfcEvent.uid);
    if (lastProcessedTime && now - lastProcessedTime < 3000) {
      if (enableDebugLogs) {
        console.log('[KioskPhotoBorrowPage] Skipping recently processed UID:', nfcEvent.uid, 'last processed:', lastProcessedTime, 'elapsed:', now - lastProcessedTime, 'ms');
      }
      return;
    }

    // 処理中フラグを立てる（重複処理を防ぐ）- 最初に設定して、useEffectの再実行を防ぐ
    processingRef.current = true;
    lastEventKeyRef.current = eventKey;
    processedUids.set(nfcEvent.uid, now); // 処理済みUIDを記録（処理開始時に即座に記録）

    if (enableDebugLogs) {
      console.log('[KioskPhotoBorrowPage] Processing NFC event:', nfcEvent.uid, 'eventKey:', eventKey);
    }

    // 従業員タグをスキャンしたら、カメラで撮影してから持出処理を開始
    const currentUid = nfcEvent.uid; // クロージャで値を保持
    setEmployeeTagUid(currentUid);
    setIsCapturing(true);
    setError(null);
    setSuccessLoan(null);

    // カメラで撮影してからAPIを呼び出す（async関数として定義）
    (async () => {
      // カメラで撮影（3回までリトライ）
      // スキャン時のみカメラを起動して撮影（CPU負荷削減のため）
      let photoData: string;
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          // カメラを起動→撮影→停止（captureAndCompressPhoto内で自動的に停止される）
          photoData = await captureAndCompressPhoto();
          break; // 成功したらループを抜ける
        } catch (error) {
          retryCount++;
          const enableDebugLogs = import.meta.env.VITE_ENABLE_DEBUG_LOGS !== 'false';
          if (enableDebugLogs) {
            console.warn(`[KioskPhotoBorrowPage] Photo capture failed (attempt ${retryCount}/${maxRetries}):`, error);
          }
          if (retryCount >= maxRetries) {
            setIsCapturing(false);
            const err = error instanceof Error ? error : new Error(String(error));
            setError(`写真の撮影に失敗しました: ${err.message}`);
            processingRef.current = false;
            return; // エラー時は処理を中断
          }
          // リトライ前に少し待機
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      // APIを呼び出して持出処理
      photoBorrowMutation.mutate(
        {
          employeeTagUid: currentUid,
          photoData: photoData!,
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
    })();
  }, [nfcEvent?.uid, nfcEvent?.timestamp, photoBorrowMutation, resolvedClientId]); // isCapturingを依存配列から除外（processingRefで制御）

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
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="写真撮影持出">
          <div className="space-y-4 text-center">
            {/* 撮影中の表示（スキャン時のみカメラを起動） */}
            {isCapturing && (
              <div className="mx-auto w-full max-w-2xl rounded-lg bg-blue-600/20 p-8">
                <div className="flex flex-col items-center justify-center space-y-4">
                  <div className="h-16 w-16 animate-spin rounded-full border-4 border-blue-300 border-t-transparent"></div>
                  <p className="text-xl font-semibold text-blue-300">カメラを起動中...</p>
                  <p className="text-sm text-white/70">従業員タグをスキャンしました</p>
                  <p className="text-sm text-white/70">写真を撮影しています。しばらくお待ちください</p>
                </div>
              </div>
            )}
            
            {/* 待機中の表示（スキャン待ち） */}
            {!isCapturing && !employeeTagUid && !error && !successLoan && (
              <div className="mx-auto w-full max-w-2xl rounded-lg border border-white/10 bg-black/20 p-8">
                <div className="flex flex-col items-center justify-center space-y-4">
                  <div className="text-6xl">📷</div>
                  <p className="text-lg font-semibold text-white">従業員タグをスキャンしてください</p>
                  <p className="text-sm text-white/70">スキャン時に自動的に写真を撮影します</p>
                </div>
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

