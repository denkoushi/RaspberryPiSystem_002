import { useMachine } from '@xstate/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';

import {
  DEFAULT_CLIENT_KEY,
  getMeasuringInstrumentByTagUid,
  getRiggingGearByTagUid,
  getUnifiedItems,
  postClientLogs,
  setClientKeyHeader
} from '../../api/client';
import { useActiveLoans, useBorrowMutation, useKioskConfig } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { createBorrowMachine } from '../../features/kiosk/borrowMachine';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useNfcStream } from '../../hooks/useNfcStream';

import { KioskReturnPage } from './KioskReturnPage';


import type { AxiosError } from 'axios';

export function KioskBorrowPage() {
  useKioskConfig(); // 初期設定取得（キャッシュ用途）
  const [clientKey, setClientKey] = useLocalStorage('kiosk-client-key', DEFAULT_CLIENT_KEY);
  const [clientId] = useLocalStorage('kiosk-client-id', '');
  const resolvedClientKey = clientKey || DEFAULT_CLIENT_KEY;
  const resolvedClientId = clientId || undefined;
  const navigate = useNavigate();
  // 親コンポーネントでデータを取得し、子コンポーネントにpropsで渡す（根本解決）
  // 返却一覧は全クライアント分を表示（過去の貸出も見落とさないため）
  const loansQuery = useActiveLoans(undefined, resolvedClientKey);
  const borrowMutation = useBorrowMutation(resolvedClientKey);
  const machine = useMemo(() => createBorrowMachine(), []);
  const [state, send] = useMachine(machine);
  // スコープ分離: このページがアクティブな場合のみNFCを有効にする
  const isActiveRoute = useMatch('/kiosk/tag');
  const nfcEvent = useNfcStream(Boolean(isActiveRoute));
  const lastEventKeyRef = useRef<string | null>(null);
  const [tagTypeMap, setTagTypeMap] = useState<
    Record<string, 'TOOL' | 'MEASURING_INSTRUMENT' | 'RIGGING_GEAR'>
  >({});

  // client-key が空になってもデフォルトを自動で復元する
  useEffect(() => {
    if (!clientKey || clientKey === 'client-demo-key') {
      setClientKey(DEFAULT_CLIENT_KEY);
      setClientKeyHeader(DEFAULT_CLIENT_KEY);
    } else {
      setClientKeyHeader(clientKey);
    }
  }, [clientKey, setClientKey]);

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

  useEffect(() => {
    if (state.value !== 'submitting' || borrowMutation.isPending) {
      return;
    }
    const payload = {
      itemTagUid: state.context.itemTagUid ?? '',
      employeeTagUid: state.context.employeeTagUid ?? '',
      clientId: clientId || undefined
    };

    // デバッグログをサーバーに送信（ブラウザコンソールが見られない環境向け）
    postClientLogs(
      {
        clientId: resolvedClientId || 'raspberrypi4-kiosk1',
        logs: [
          {
            level: 'DEBUG',
            message: 'kiosk-borrow submitting',
            context: { payload }
          }
        ]
      },
      resolvedClientKey
    ).catch(() => {
      /* noop */
    });

    const attemptBorrow = async (swapOrder = false) => {
      const p = swapOrder
        ? { ...payload, itemTagUid: payload.employeeTagUid, employeeTagUid: payload.itemTagUid }
        : payload;
      return borrowMutation.mutateAsync(p);
    };

    attemptBorrow()
      .then((loan) => send({ type: 'SUCCESS', loan }))
      .catch(async (error: unknown) => {
        const apiError = error as Partial<AxiosError<{ message?: string }>>;
        const apiMessage: string | undefined = apiError.response?.data?.message;
        const rawMessage =
          typeof apiMessage === 'string' && apiMessage.length > 0 ? apiMessage : apiError?.message;
        const toShortMessage = (msg?: string) => {
          if (!msg) return '登録に失敗しました';
          if (msg.includes('アイテムが登録されていません') || msg.toLowerCase().includes('item not found')) {
            return 'タグ未登録（アイテム）';
          }
          if (msg.includes('従業員が登録されていません') || msg.toLowerCase().includes('employee not found')) {
            return 'タグ未登録（社員）';
          }
          return msg.length > 40 ? '登録エラーが発生しました' : msg;
        };
        const message = toShortMessage(rawMessage);

        // エラーログをサーバーに送信
        postClientLogs(
          {
            clientId: resolvedClientId || 'raspberrypi4-kiosk1',
            logs: [
              {
                level: 'ERROR',
                message: `kiosk-borrow failed: ${rawMessage || 'Unknown error'}`,
                context: {
                  payload,
                  error: {
                    message: apiError?.message,
                    status: apiError?.response?.status,
                    statusText: apiError?.response?.statusText,
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

        // アイテム/従業員の取り違えと思われる場合は一度だけ順序を入れ替えて再試行
        const notFoundItem = apiMessage?.includes('アイテムが登録されていません');
        const notFoundEmployee = apiMessage?.includes('従業員が登録されていません');
        if ((notFoundItem || notFoundEmployee) && payload.itemTagUid && payload.employeeTagUid) {
          try {
            const loan = await attemptBorrow(true);
            send({ type: 'SUCCESS', loan });
            return;
          } catch (retryError: unknown) {
            const retryApiErr = retryError as Partial<AxiosError<{ message?: string }>>;
            const retryMsg =
              retryApiErr.response?.data?.message || retryApiErr?.message || 'エラーが発生しました (再試行失敗)';
            
            // 再試行失敗時のエラーログも送信
            postClientLogs(
              {
                clientId: resolvedClientId || 'raspberrypi4-kiosk1',
                logs: [
                  {
                    level: 'ERROR',
                    message: `kiosk-borrow retry failed: ${retryMsg}`,
                    context: {
                      payload,
                      retryError: {
                        message: retryApiErr?.message,
                        status: retryApiErr?.response?.status,
                        apiMessage: retryApiErr.response?.data?.message
                      }
                    }
                  }
                ]
              },
              resolvedClientKey
            ).catch(() => {
              /* noop - ログ送信失敗は無視 */
            });
            
            send({ type: 'FAIL', message: retryMsg });
            return;
          }
        }

        send({ type: 'FAIL', message: message ?? '登録エラーが発生しました' });
      });
  }, [borrowMutation, clientId, resolvedClientId, resolvedClientKey, send, state]);

  useEffect(() => {
    // デバッグログの出力制御（環境変数で制御可能、デフォルトは開発中は常に出力）
    const enableDebugLogs = import.meta.env.VITE_ENABLE_DEBUG_LOGS !== 'false';
    
    if (enableDebugLogs) {
      console.log('NFC Event received:', nfcEvent);
      console.log('Current state:', state.value, 'Context:', JSON.stringify(state.context, null, 2));
    }
    if (!nfcEvent) return;
    const eventKey = `${nfcEvent.uid}:${nfcEvent.timestamp}`;
    if (lastEventKeyRef.current === eventKey) {
      if (enableDebugLogs) {
        console.log('Skipping duplicate NFC event:', eventKey);
      }
      return;
    }
    const processNfc = async () => {
      const isFirstScan = !state.context.itemTagUid && !state.context.employeeTagUid;
      const cachedType = tagTypeMap[nfcEvent.uid];

      // デバッグログをサーバーに送信
      postClientLogs(
        {
          clientId: resolvedClientId || 'raspberrypi4-kiosk1',
          logs: [
            {
              level: 'DEBUG',
              message: 'tag-page nfc event',
              context: { uid: nfcEvent.uid, cachedType, isFirstScan }
            }
          ]
        },
        resolvedClientKey
      ).catch(() => {});

      // 事前に取得したマップで計測機器タグ/吊具タグと判定できる場合は即座に遷移
      if (cachedType === 'MEASURING_INSTRUMENT') {
        navigate(`/kiosk/instruments/borrow?tagUid=${encodeURIComponent(nfcEvent.uid)}`);
        lastEventKeyRef.current = eventKey;
        return;
      }
      if (cachedType === 'RIGGING_GEAR') {
        navigate(`/kiosk/rigging/borrow?tagUid=${encodeURIComponent(nfcEvent.uid)}`);
        lastEventKeyRef.current = eventKey;
        return;
      }

      try {
        // APIで計測機器タグなら計測機器持出ページへ遷移（タグUIDをクエリで渡す）
        // 計測機器タグ判定
        const instrument = await getMeasuringInstrumentByTagUid(nfcEvent.uid);
        if (instrument) {
          navigate(`/kiosk/instruments/borrow?tagUid=${encodeURIComponent(nfcEvent.uid)}`);
          lastEventKeyRef.current = eventKey;
          return;
        }
      } catch {
        // 計測機器なし → 続行
      }

      // 吊具タグ判定
      try {
        const rigging = await getRiggingGearByTagUid(nfcEvent.uid);
        if (rigging) {
          navigate(`/kiosk/rigging/borrow?tagUid=${encodeURIComponent(nfcEvent.uid)}`);
          lastEventKeyRef.current = eventKey;
          return;
        }
      } catch {
        // 404や他のエラーは工具フローを継続
      }

      // 任意順序で処理する: まだitemが未設定ならITEMとして、itemが既にあればEMPLOYEEとして送信
      const shouldSendItem = !state.context.itemTagUid;
      const eventType = shouldSendItem ? 'ITEM_SCANNED' : 'EMPLOYEE_SCANNED';
      if (enableDebugLogs) {
        console.log(`Sending ${eventType}:`, nfcEvent.uid);
      }
      send({ type: eventType, uid: nfcEvent.uid });
      lastEventKeyRef.current = eventKey;
    };

    processNfc();
  }, [nfcEvent, navigate, send, state, tagTypeMap, resolvedClientId, resolvedClientKey]);

  const handleReset = () => {
    // 単純な画面リロードでキャッシュも含めて初期化
    if (typeof window !== 'undefined') {
      window.location.reload();
      return;
    }
    lastEventKeyRef.current = null;
    send({ type: 'RESET' });
  };

  return (
    <div className="flex h-full gap-4">
      <div className="w-80 flex-shrink-0">
        <Card title="持出フロー" className="h-full">
          <div className="space-y-3 text-center">
            <div className="grid gap-4 md:grid-cols-2">
              <StepCard
                title="① アイテム"
                active={!state.context.itemTagUid}
                value={state.context.itemTagUid}
              />
              <StepCard
                title="② 社員"
                active={Boolean(state.context.itemTagUid) && !state.context.employeeTagUid}
                value={state.context.employeeTagUid}
              />
            </div>
            <div className="flex justify-center gap-4">
              <Button onClick={handleReset}>リセット</Button>
            </div>
            {state.context.error ? <p className="text-sm font-semibold text-red-400">{state.context.error}</p> : null}
            {state.context.loan ? (
              <div className="rounded-lg border-2 border-emerald-700 bg-emerald-600 p-4 text-left text-white shadow-lg">
                <p className="text-lg font-bold">登録完了</p>
                <p className="text-base font-semibold mt-1">
                  {state.context.loan.item?.name ?? 'アイテム情報なし'} を {state.context.loan.employee.displayName} さんが持出済み
                </p>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="flex-1 min-w-0">
        <KioskReturnPage loansQuery={loansQuery} clientKey={resolvedClientKey} />
      </div>
    </div>
  );
}

function StepCard({ title, value, active }: { title: string; value?: string; active: boolean }) {
  return (
    <div
      className={`rounded-xl border-2 p-4 shadow-lg ${
        active
          ? 'border-emerald-400 bg-emerald-600 text-white'
          : 'border-white/20 bg-white/10 text-white/80'
      }`}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-2 text-xl font-bold">{value ?? '---'}</p>
    </div>
  );
}
