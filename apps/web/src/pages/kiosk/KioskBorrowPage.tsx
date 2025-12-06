import { useEffect, useMemo, useRef } from 'react';
import { useMachine } from '@xstate/react';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useActiveLoans, useBorrowMutation, useKioskConfig } from '../../api/hooks';
import { useNfcStream } from '../../hooks/useNfcStream';
import { createBorrowMachine } from '../../features/kiosk/borrowMachine';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { KioskReturnPage } from './KioskReturnPage';
import { DEFAULT_CLIENT_KEY, setClientKeyHeader } from '../../api/client';

export function KioskBorrowPage() {
  const { data: config } = useKioskConfig();
  const [clientKey, setClientKey] = useLocalStorage('kiosk-client-key', DEFAULT_CLIENT_KEY);
  const [clientId, setClientId] = useLocalStorage('kiosk-client-id', '');
  const resolvedClientKey = clientKey || DEFAULT_CLIENT_KEY;
  const resolvedClientId = clientId || undefined;
  // 親コンポーネントでデータを取得し、子コンポーネントにpropsで渡す（根本解決）
  const loansQuery = useActiveLoans(resolvedClientId, resolvedClientKey);
  const borrowMutation = useBorrowMutation(resolvedClientKey);
  const machine = useMemo(() => createBorrowMachine(), []);
  const [state, send] = useMachine(machine);
  const nfcEvent = useNfcStream();
  const lastEventKeyRef = useRef<string | null>(null);

  // client-key が空になってもデフォルトを自動で復元する
  useEffect(() => {
    if (!clientKey || clientKey === 'client-demo-key') {
      setClientKey(DEFAULT_CLIENT_KEY);
      setClientKeyHeader(DEFAULT_CLIENT_KEY);
    } else {
      setClientKeyHeader(clientKey);
    }
  }, [clientKey, setClientKey]);

  useEffect(() => {
    if (!state.matches('submitting') || borrowMutation.isPending) {
      return;
    }
    const payload = {
      itemTagUid: state.context.itemTagUid ?? '',
      employeeTagUid: state.context.employeeTagUid ?? '',
      clientId: clientId || undefined
    };

    const attemptBorrow = async (swapOrder = false) => {
      const p = swapOrder
        ? { ...payload, itemTagUid: payload.employeeTagUid, employeeTagUid: payload.itemTagUid }
        : payload;
      return borrowMutation.mutateAsync(p);
    };

    attemptBorrow()
      .then((loan) => send({ type: 'SUCCESS', loan }))
      .catch(async (error: any) => {
        const apiMessage: string | undefined = error?.response?.data?.message;
        const message = typeof apiMessage === 'string' && apiMessage.length > 0 ? apiMessage : error?.message;

        // アイテム/従業員の取り違えと思われる場合は一度だけ順序を入れ替えて再試行
        const notFoundItem = apiMessage?.includes('アイテムが登録されていません');
        const notFoundEmployee = apiMessage?.includes('従業員が登録されていません');
        if ((notFoundItem || notFoundEmployee) && payload.itemTagUid && payload.employeeTagUid) {
          try {
            const loan = await attemptBorrow(true);
            send({ type: 'SUCCESS', loan });
            return;
          } catch (retryError: any) {
            const retryMsg =
              retryError?.response?.data?.message || retryError?.message || 'エラーが発生しました (再試行失敗)';
            send({ type: 'FAIL', message: retryMsg });
            return;
          }
        }

        send({ type: 'FAIL', message: message ?? 'エラーが発生しました' });
      });
  }, [borrowMutation, clientId, send, state]);

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
    if (state.matches('waitItem')) {
      if (enableDebugLogs) {
        console.log('Sending ITEM_SCANNED:', nfcEvent.uid);
      }
      send({ type: 'ITEM_SCANNED', uid: nfcEvent.uid });
      lastEventKeyRef.current = eventKey;
    } else if (state.matches('waitEmployee')) {
      if (enableDebugLogs) {
        console.log('Sending EMPLOYEE_SCANNED:', nfcEvent.uid);
      }
      send({ type: 'EMPLOYEE_SCANNED', uid: nfcEvent.uid });
      lastEventKeyRef.current = eventKey;
    }
  }, [nfcEvent, send, state.value]);

  const handleReset = () => {
    lastEventKeyRef.current = null;
    send({ type: 'RESET' });
  };

  return (
    <div className="flex h-full gap-4">
      <div className="w-80 flex-shrink-0">
        <Card title="持出フロー" className="h-full">
          <div className="space-y-3 text-center">
            <div className="grid gap-4 md:grid-cols-2">
              <StepCard title="① アイテム" active={state.matches('waitItem')} value={state.context.itemTagUid} />
              <StepCard title="② 社員" active={state.matches('waitEmployee')} value={state.context.employeeTagUid} />
            </div>
            <div className="flex justify-center gap-4">
              <Button onClick={handleReset}>リセット</Button>
            </div>
            {state.context.error ? <p className="text-red-400">{state.context.error}</p> : null}
            {state.context.loan ? (
              <div className="rounded-lg bg-emerald-600/20 p-4 text-left">
                <p className="text-lg font-semibold text-emerald-300">登録完了</p>
                <p>
                  {state.context.loan.item?.name ?? 'アイテム情報なし'} を {state.context.loan.employee.displayName} さんが持出済み
                </p>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="flex-1 min-w-0">
        <KioskReturnPage loansQuery={loansQuery} clientId={resolvedClientId} clientKey={resolvedClientKey} />
      </div>
    </div>
  );
}

function StepCard({ title, value, active }: { title: string; value?: string; active: boolean }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        active ? 'border-emerald-400 bg-emerald-500/10 text-white' : 'border-white/10 text-white/70'
      }`}
    >
      <p className="text-sm">{title}</p>
      <p className="mt-2 text-xl font-bold">{value ?? '---'}</p>
    </div>
  );
}
