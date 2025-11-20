import { useEffect, useMemo, useRef } from 'react';
import { useMachine } from '@xstate/react';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useBorrowMutation, useKioskConfig } from '../../api/hooks';
import { useNfcStream } from '../../hooks/useNfcStream';
import { createBorrowMachine } from '../../features/kiosk/borrowMachine';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

export function KioskBorrowPage() {
  const { data: config } = useKioskConfig();
  const [clientKey, setClientKey] = useLocalStorage('kiosk-client-key', 'client-demo-key');
  const [clientId, setClientId] = useLocalStorage('kiosk-client-id', '');
  const resolvedClientKey = clientKey || 'client-demo-key';
  const borrowMutation = useBorrowMutation(resolvedClientKey);
  const machine = useMemo(() => createBorrowMachine(), []);
  const [state, send] = useMachine(machine);
  const nfcEvent = useNfcStream();
  const lastEventKeyRef = useRef<string | null>(null);

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
    console.log('NFC Event received:', nfcEvent);
    console.log('Current state:', state.value, 'Context:', JSON.stringify(state.context, null, 2));
    if (!nfcEvent) return;
    const eventKey = `${nfcEvent.uid}:${nfcEvent.timestamp}`;
    if (lastEventKeyRef.current === eventKey) {
      console.log('Skipping duplicate NFC event:', eventKey);
      return;
    }
    if (state.matches('waitItem')) {
      console.log('Sending ITEM_SCANNED:', nfcEvent.uid);
      send({ type: 'ITEM_SCANNED', uid: nfcEvent.uid });
      lastEventKeyRef.current = eventKey;
    } else if (state.matches('waitEmployee')) {
      console.log('Sending EMPLOYEE_SCANNED:', nfcEvent.uid);
      send({ type: 'EMPLOYEE_SCANNED', uid: nfcEvent.uid });
      lastEventKeyRef.current = eventKey;
    }
  }, [nfcEvent, send, state.value]);

  const handleReset = () => {
    lastEventKeyRef.current = null;
    send({ type: 'RESET' });
  };

  return (
    <div className="space-y-6">
      <Card title="ステーション設定">
        <div className="grid gap-4 md:grid-cols-2">
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

      <Card title="持出ステップ">
        <div className="space-y-4 text-center">
          <p className="text-3xl font-semibold">{config?.greeting ?? 'アイテム → 社員証の順にタップ'}</p>
          <div className="grid gap-4 md:grid-cols-3">
            <StepCard title="① アイテム" active={state.matches('waitItem')} value={state.context.itemTagUid} />
            <StepCard title="② 社員" active={state.matches('waitEmployee')} value={state.context.employeeTagUid} />
            <StepCard title="③ 確認" active={state.matches('confirm')} value={state.context.loan?.item.name} />
          </div>
        <div className="flex justify-center gap-4">
          <Button onClick={handleReset}>リセット</Button>
          <Button
            onClick={() => send({ type: 'SUBMIT' })}
            disabled={!state.matches('confirm') || borrowMutation.isPending}
          >
            {borrowMutation.isPending ? '登録中…' : '記録'}
          </Button>
        </div>
          {state.context.error ? <p className="text-red-400">{state.context.error}</p> : null}
          {state.context.loan ? (
            <div className="rounded-lg bg-emerald-600/20 p-4 text-left">
              <p className="text-lg font-semibold text-emerald-300">登録完了</p>
              <p>
                {state.context.loan.item.name} を {state.context.loan.employee.displayName} さんが持出済み
              </p>
            </div>
          ) : null}
        </div>
      </Card>

      <Card title="最新スキャン">
        <div className="text-center text-lg">
          {nfcEvent ? (
            <>
              <p className="font-mono text-3xl">{nfcEvent.uid}</p>
              <p className="text-sm text-white/60">{nfcEvent.timestamp}</p>
            </>
          ) : (
            <p>待機中...</p>
          )}
        </div>
      </Card>
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
