import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import { useMatch, useNavigate, useSearchParams } from 'react-router-dom';

import {
  DEFAULT_CLIENT_KEY,
  borrowRiggingGear,
  getRiggingGearByTagUid,
  postClientLogs,
  setClientKeyHeader
} from '../../api/client';
import { useKioskConfig } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useNfcStream } from '../../hooks/useNfcStream';

export function KioskRiggingBorrowPage() {
  const isActiveRoute = useMatch('/kiosk/rigging/borrow');
  const nfcEvent = useNfcStream(Boolean(isActiveRoute));
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { data: kioskConfig } = useKioskConfig();
  const returnPath = kioskConfig?.defaultMode === 'PHOTO' ? '/kiosk/photo' : '/kiosk/tag';

  const [clientKey, setClientKey] = useLocalStorage('kiosk-client-key', DEFAULT_CLIENT_KEY);
  const [clientId] = useLocalStorage('kiosk-client-id', '');
  const resolvedClientKey = clientKey || DEFAULT_CLIENT_KEY;
  const resolvedClientId = clientId || undefined;

  const [riggingTagUid, setRiggingTagUid] = useState(searchParams.get('tagUid') ?? '');
  const [employeeTagUid, setEmployeeTagUid] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const processingRef = useRef(false);

  useEffect(() => {
    if (!clientKey || clientKey === 'client-demo-key') {
      setClientKey(DEFAULT_CLIENT_KEY);
      setClientKeyHeader(DEFAULT_CLIENT_KEY);
    } else {
      setClientKeyHeader(clientKey);
    }
  }, [clientKey, setClientKey]);

  // NFCイベント: 1枚目=吊具タグ, 2枚目=従業員タグ
  useEffect(() => {
    if (!nfcEvent || processingRef.current) return;
    processingRef.current = true;

    // デバッグログ送信
    postClientLogs(
      {
        clientId: resolvedClientId || 'raspberrypi4-kiosk1',
        logs: [
          {
            level: 'DEBUG',
            message: 'rigging-page nfc event',
            context: { uid: nfcEvent.uid, timestamp: nfcEvent.timestamp, riggingTagUid, employeeTagUid }
          }
        ]
      },
      resolvedClientKey
    ).catch(() => {});

    (async () => {
      try {
        if (!riggingTagUid) {
          // 1枚目: 吊具タグとして受け取る
          setRiggingTagUid(nfcEvent.uid);
          setMessage('吊具タグを読み取りました。次に従業員タグをスキャンしてください。');
          return;
        }

        if (!employeeTagUid) {
          // 2枚目: 従業員タグとして受け取る
          setEmployeeTagUid(nfcEvent.uid);

          setIsSubmitting(true);
          setError(null);
          setMessage(null);

          const gear = await getRiggingGearByTagUid(riggingTagUid);
          if (!gear) {
            throw new Error('吊具が登録されていません');
          }

          const loan = await borrowRiggingGear({
            riggingTagUid,
            employeeTagUid: nfcEvent.uid,
            clientId: resolvedClientId
          });

          setMessage(`持出登録完了: Loan ID = ${loan.id}`);
          setRiggingTagUid('');
          setEmployeeTagUid('');
          // 計測機器と同じく成功時は戻り先へ自動遷移
          navigate(returnPath, { replace: true });
        }
      } catch (err) {
        const msg =
          axios.isAxiosError(err) && err.response?.data?.message
            ? err.response.data.message
            : err instanceof Error
            ? err.message
            : '持出に失敗しました';
        setError(msg);
        setMessage(null);
        // エラー詳細をログ送信
        postClientLogs(
          {
            clientId: resolvedClientId || 'raspberrypi4-kiosk1',
            logs: [
              {
                level: 'ERROR',
                message: 'rigging borrow failed',
                context: {
                  error: msg,
                  riggingTagUid,
                  employeeTagUid: employeeTagUid || nfcEvent?.uid
                }
              }
            ]
          },
          resolvedClientKey
        ).catch(() => {});
      } finally {
        setIsSubmitting(false);
        processingRef.current = false;
      }
    })();
    // success表示中でも新しいイベントは処理するので依存配列なし
  }, [nfcEvent, riggingTagUid, employeeTagUid, resolvedClientId, resolvedClientKey, navigate, returnPath]);

  return (
    <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-2">
                <h2 className="text-xl font-semibold">吊具 持出</h2>
                <p className="text-sm text-white/70">吊具タグ → 従業員タグ の順にスキャンしてください。</p>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-white/60">吊具タグUID:</span>
                  <span className="font-mono">{riggingTagUid || '-'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white/60">従業員タグUID:</span>
                  <span className="font-mono">{employeeTagUid || '-'}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setRiggingTagUid('');
                      setEmployeeTagUid('');
                      setMessage(null);
                      setError(null);
                    }}
                  >
                    リセット
                  </Button>
                  <Button
                    onClick={() =>
                      navigate('/kiosk', {
                        replace: true
                      })
                    }
                    variant="secondary"
                  >
                    持出一覧へ戻る
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[3fr,1fr]">
            <div className="flex flex-col gap-3">
              <div className="rounded-md border border-white/10 bg-white/5 p-3">
                <p className="text-sm font-semibold text-amber-200">点検見本（確認のみ）</p>
                <img
                  src="/assets/rigging-inspection.png"
                  alt="Rigging inspection reference"
                  className="mt-2 w-full max-w-none rounded-md border border-white/10 object-contain"
                />
                <p className="mt-2 text-xs text-white/70">画像を参照し、目視点検後にOK/NGを判断してください。</p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {message && <div className="rounded-md bg-emerald-900/50 p-3 text-emerald-200">{message}</div>}
              {error && <div className="rounded-md bg-red-900/50 p-3 text-red-200">{error}</div>}
              {isSubmitting && <div className="text-sm text-white/70">送信中…</div>}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
