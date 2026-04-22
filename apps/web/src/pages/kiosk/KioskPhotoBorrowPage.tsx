import { useEffect, useRef, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';

import {
  getResolvedClientKey,
  getMeasuringInstrumentByTagUid,
  getUnifiedItems,
  getRiggingGearByTagUid,
  postClientLogs
} from '../../api/client';
import { useActiveLoans, useKioskConfig, usePhotoBorrowMutation } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PalletVizEmbeddedPanel } from '../../features/kiosk/pallet-visualization';
import { useNfcStream } from '../../hooks/useNfcStream';
import { captureAndCompressPhoto } from '../../utils/camera';

import { KioskReturnPage } from './KioskReturnPage';

import type { Loan } from '../../api/types';
import type { AxiosError } from 'axios';

export function KioskPhotoBorrowPage() {
  useKioskConfig(); // 初期設定取得（キャッシュ用途）
  const resolvedClientKey = getResolvedClientKey();
  const resolvedClientId = undefined;
  // 返却一覧は全クライアント分を表示（過去の貸出も見落とさないため）
  const loansQuery = useActiveLoans(undefined, resolvedClientKey);
  const photoBorrowMutation = usePhotoBorrowMutation(resolvedClientKey);
  // スコープ分離: このページがアクティブな場合のみNFCを有効にする
  const isActiveRoute = useMatch('/kiosk/photo');
  const nfcEvent = useNfcStream(Boolean(isActiveRoute));
  const lastEventKeyRef = useRef<string | null>(null);
  const processedUidsRef = useRef<Map<string, number>>(new Map()); // 処理済みUIDとタイムスタンプのマップ
  const processedEventTimestampsRef = useRef<Map<string, string>>(new Map()); // 処理済みUIDとイベントタイムスタンプのマップ
  const [tagTypeMap, setTagTypeMap] = useState<
    Record<string, 'TOOL' | 'MEASURING_INSTRUMENT' | 'RIGGING_GEAR'>
  >({});
  const navigate = useNavigate();
  // タグの種別マップを取得（工具/計測機器の判定を高速化）
  useEffect(() => {
    let cancelled = false;
    getUnifiedItems({ category: 'ALL' })
      .then((items) => {
        if (cancelled) return;
        const map: Record<string, 'TOOL' | 'MEASURING_INSTRUMENT' | 'RIGGING_GEAR'> = {};
        items.forEach((item) => {
          if (item.nfcTagUid) {
            map[item.nfcTagUid] = item.type;
          }
        });
        setTagTypeMap(map);
      })
      .catch(() => {
        // マップ取得に失敗しても致命的ではないため握りつぶす
      });
    return () => {
      cancelled = true;
    };
  }, []);


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
      processedEventTimestampsRef.current.clear(); // 処理済みタイムスタンプリストをクリア
    }, 500);
    return () => clearTimeout(timer);
  }, []);


  // 処理済みUIDのクリーンアップ（3秒以上古いエントリを削除）
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const processedUids = processedUidsRef.current;
      const processedEventTimestamps = processedEventTimestampsRef.current;
      for (const [uid, timestamp] of processedUids.entries()) {
        if (now - timestamp > 3000) {
          // 3秒以上古いエントリを削除
          processedUids.delete(uid);
          processedEventTimestamps.delete(uid);
        }
      }
    }, 1000); // 1秒ごとにクリーンアップ

    return () => clearInterval(cleanupInterval);
  }, []);

  // NFCイベントの処理
  // isCapturing / nfcEvent object 依存を外し、同一イベントでの再実行を防ぐ（KB-035の再発防止）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // デバッグログの出力制御（環境変数で制御可能、デフォルトは開発中は常に出力）
    const enableDebugLogs = import.meta.env.VITE_ENABLE_DEBUG_LOGS !== 'false';
    
    // ページマウント前、または処理中、またはNFCイベントがない場合はスキップ
    if (!pageMountedRef.current) {
      if (enableDebugLogs) {
        console.log('[KioskPhotoBorrowPage] Skipping: page not mounted');
      }
      return;
    }
    if (!nfcEvent) {
      if (enableDebugLogs) {
        console.log('[KioskPhotoBorrowPage] Skipping: no NFC event');
      }
      return;
    }
    // エラー表示中は、ユーザーがリセットするまで新しいNFCイベントを受け付けない
    // （暗所などでの連続失敗時に「置きっぱなし」で再試行が暴発するのを防ぐ）
    if (error) {
      if (enableDebugLogs) {
        console.log('[KioskPhotoBorrowPage] Skipping: error displayed, waiting for reset');
      }
      return;
    }
    if (isCapturing) {
      if (enableDebugLogs) {
        console.log('[KioskPhotoBorrowPage] Skipping: already capturing');
      }
      return;
    }
    if (processingRef.current) {
      if (enableDebugLogs) {
        console.log('[KioskPhotoBorrowPage] Skipping: already processing');
      }
      return;
    }
    // successLoanが設定されている間（成功表示中）は新しいNFCイベントをスキップ
    // 「従業員タグをスキャンしてください」に戻る前にスキャンしたイベントを無視するため
    if (successLoan) {
      if (enableDebugLogs) {
        console.log('[KioskPhotoBorrowPage] Skipping: success loan displayed, waiting for reset');
      }
      return;
    }
    
    const eventKey = `${nfcEvent.uid}:${nfcEvent.timestamp}`;
    const now = Date.now();
    const processedUids = processedUidsRef.current;
    const processedEventTimestamps = processedEventTimestampsRef.current;

    // 同じeventKeyを既に処理済みの場合はスキップ
    if (lastEventKeyRef.current === eventKey) {
      if (enableDebugLogs) {
        console.log('[KioskPhotoBorrowPage] Skipping duplicate event:', eventKey);
      }
      return;
    }
    
    // 同じUIDの処理済みタイムスタンプを確認
    const lastProcessedTimestamp = processedEventTimestamps.get(nfcEvent.uid);
    if (lastProcessedTimestamp) {
      // タイムスタンプを比較（ISO文字列を比較）
      if (nfcEvent.timestamp <= lastProcessedTimestamp) {
        if (enableDebugLogs) {
          console.log('[KioskPhotoBorrowPage] Skipping old event timestamp:', nfcEvent.uid, 'current:', nfcEvent.timestamp, 'last processed:', lastProcessedTimestamp);
        }
        return;
      }
    }
    
    // 同じUIDが3秒以内に処理済みの場合はスキップ（タイムスタンプが新しい場合でも、処理中の場合はスキップ）
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
    processedEventTimestamps.set(nfcEvent.uid, nfcEvent.timestamp); // 処理済みタイムスタンプを記録

    // デバッグログをサーバーに送信（重複判定後に送る）
    const cachedType = tagTypeMap[nfcEvent.uid];
    postClientLogs(
      {
        clientId: resolvedClientId || 'raspberrypi4-kiosk1',
        logs: [
          {
            level: 'DEBUG',
            message: 'photo-page nfc event',
            context: { uid: nfcEvent.uid, cachedType, timestamp: nfcEvent.timestamp }
          }
        ]
      },
      resolvedClientKey
    ).catch(() => {});

    if (enableDebugLogs) {
      console.log('[KioskPhotoBorrowPage] Processing NFC event:', nfcEvent.uid, 'eventKey:', eventKey, 'timestamp:', nfcEvent.timestamp);
    }

    // 計測機器/吊具タグ判定（カメラ起動前に判定）
    // 明示的に登録されているタグのみ専用タブへ遷移
    // 未登録タグ（404）は従業員フローを継続（誤判定防止）
    void (async () => {
      const cachedType = tagTypeMap[nfcEvent.uid];

      // 事前に取得したマップで計測機器/吊具タグと判定できる場合は即座に遷移
      if (cachedType === 'MEASURING_INSTRUMENT') {
        processingRef.current = false; // フラグをリセット
        navigate(`/kiosk/instruments/borrow?tagUid=${encodeURIComponent(nfcEvent.uid)}`);
        return;
      }
      if (cachedType === 'RIGGING_GEAR') {
        processingRef.current = false;
        navigate(`/kiosk/rigging/borrow?tagUid=${encodeURIComponent(nfcEvent.uid)}`);
        return;
      }

      try {
        // APIで計測機器タグなら計測機器持出ページへ遷移
        const instrument = await getMeasuringInstrumentByTagUid(nfcEvent.uid);
        if (instrument) {
          processingRef.current = false; // フラグをリセット
          navigate(`/kiosk/instruments/borrow?tagUid=${encodeURIComponent(nfcEvent.uid)}`);
          return;
        }
      } catch {
        // 404や他のエラーは従業員フローを継続（未登録タグは計測機器として扱わない）
      }

      try {
        const rigging = await getRiggingGearByTagUid(nfcEvent.uid);
        if (rigging) {
          processingRef.current = false;
          navigate(`/kiosk/rigging/borrow?tagUid=${encodeURIComponent(nfcEvent.uid)}`);
          return;
        }
      } catch {
        // 404や他のエラーは従業員フローを継続
      }

      // 計測機器タグでない場合、従業員タグとして処理を継続（カメラ起動）
    const currentUid = nfcEvent.uid; // クロージャで値を保持
    setEmployeeTagUid(currentUid);
      setIsCapturing(true);
    setError(null);
    setSuccessLoan(null);

      // カメラで撮影してからAPIを呼び出す
    (async () => {
      // カメラで撮影（3回までリトライ）
      // スキャン時のみカメラを起動して撮影（CPU負荷削減のため）
      let photoData: string;
      let retryCount = 0;
      const maxRetries = 3;

      console.log('[KioskPhotoBorrowPage] Starting camera capture...');
      
      while (retryCount < maxRetries) {
        try {
          console.log(`[KioskPhotoBorrowPage] Camera capture attempt ${retryCount + 1}/${maxRetries}`);
          // カメラを起動→撮影→停止（captureAndCompressPhoto内で自動的に停止される）
          photoData = await captureAndCompressPhoto();
          console.log('[KioskPhotoBorrowPage] Camera capture successful');
          break; // 成功したらループを抜ける
        } catch (error) {
          retryCount++;
          const err = error instanceof Error ? error : new Error(String(error));
          console.error(`[KioskPhotoBorrowPage] Photo capture failed (attempt ${retryCount}/${maxRetries}):`, err);
          
          if (retryCount >= maxRetries) {
            setIsCapturing(false);
            const errorMessage = `写真の撮影に失敗しました: ${err.message || String(err)}`;
            setError(errorMessage);
            processingRef.current = false;
            
            // エラーログをサーバーに送信
            postClientLogs(
              {
                clientId: resolvedClientId || 'raspberrypi4-kiosk1',
                logs: [
                  {
                    level: 'ERROR',
                    message: `photo-borrow capture failed after ${maxRetries} retries: ${err.message || String(err)}`,
                    context: {
                      retryCount,
                      maxRetries,
                      error: {
                        message: err.message,
                        stack: err.stack
                      }
                    }
                  }
                ]
              },
              resolvedClientKey
            ).catch(() => {
              /* noop - ログ送信失敗は無視 */
            });
            
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
        onError: (error: unknown) => {
          setIsCapturing(false);
          const apiErr = error as Partial<AxiosError<{ message?: string }>>;
          const apiMessage: string | undefined = apiErr.response?.data?.message;
          const message = typeof apiMessage === 'string' && apiMessage.length > 0 ? apiMessage : apiErr?.message;
          setError(message ?? '写真の撮影に失敗しました');
          // エラーログは本番環境でも出力（問題の特定に必要）
          console.error('[KioskPhotoBorrowPage] Photo borrow error:', error);
          
          // エラーログをサーバーに送信
          postClientLogs(
            {
              clientId: resolvedClientId || 'raspberrypi4-kiosk1',
              logs: [
                {
                  level: 'ERROR',
                  message: `photo-borrow API failed: ${message || apiErr?.message || 'Unknown error'}`,
                  context: {
                    employeeTagUid: currentUid,
                    error: {
                      message: apiErr?.message,
                      status: apiErr?.response?.status,
                      statusText: apiErr?.response?.statusText,
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
          
          // エラー時は3秒後にリセット可能にする（処理中フラグもリセット）
          // eventKeyはリセットしない（同じイベントを再度処理しないため）
          setTimeout(() => {
            processingRef.current = false;
          }, 3000);
        },
      }
      );
      })();
    })();
    // successLoanを依存配列に追加（成功表示中は新しいイベントをスキップするため）
    // isCapturing / nfcEvent object は意図的に除外（KB-035再発防止）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    nfcEvent?.eventId,
    nfcEvent?.uid,
    nfcEvent?.timestamp,
    photoBorrowMutation,
    resolvedClientId,
    resolvedClientKey,
    successLoan,
    tagTypeMap,
    navigate,
    error,
  ]);

  // ページアンマウント時に状態をリセット
  useEffect(() => {
    const processedUids = processedUidsRef.current;
    const processedEventTimestamps = processedEventTimestampsRef.current;
    return () => {
      pageMountedRef.current = false;
      lastEventKeyRef.current = null;
      processingRef.current = false;
      processedUids.clear();
      processedEventTimestamps.clear();
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
    <div className="flex h-full min-h-0 gap-4">
      <div className="flex w-80 shrink-0 flex-col gap-3 overflow-hidden min-h-0">
        <Card title="写真撮影持出" className="shrink-0">
          <div className="space-y-4 text-center">
            {/* 撮影中の表示（スキャン時のみカメラを起動） */}
            {isCapturing && (
              <div className="mx-auto w-full rounded-lg bg-blue-600/20 p-4">
                <div className="flex flex-col items-center justify-center space-y-2">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-300 border-t-transparent"></div>
                  <p className="text-sm font-semibold text-blue-300">カメラを起動中...</p>
                  <p className="text-xs text-white/70">写真を撮影しています</p>
                </div>
              </div>
            )}
            
            {/* 待機中の表示（スキャン待ち） */}
            {!isCapturing && !employeeTagUid && !error && !successLoan && (
              <div className="mx-auto w-full rounded-lg border border-white/10 bg-black/20 p-2">
                <div className="flex flex-col items-center justify-center space-y-1">
                  <div className="text-2xl">📷</div>
                  <p className="text-xs font-semibold text-white">従業員タグをスキャンしてください</p>
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
        <PalletVizEmbeddedPanel className="min-h-0 flex-1" />
      </div>

      <div className="min-h-0 min-w-0 flex-1">
        <KioskReturnPage loansQuery={loansQuery} clientKey={resolvedClientKey} />
      </div>
    </div>
  );
}

