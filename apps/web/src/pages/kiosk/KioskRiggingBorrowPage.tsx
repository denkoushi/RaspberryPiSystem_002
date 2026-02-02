import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import { useMatch, useNavigate, useSearchParams } from 'react-router-dom';

import {
  DEFAULT_CLIENT_KEY,
  borrowRiggingGear,
  getRiggingGearByTagUid,
  postClientLogs
} from '../../api/client';
import { useKioskConfig } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useNfcStream } from '../../hooks/useNfcStream';

export function KioskRiggingBorrowPage() {
  const isActiveRoute = useMatch('/kiosk/rigging/borrow');
  const nfcEvent = useNfcStream(Boolean(isActiveRoute));
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { data: kioskConfig } = useKioskConfig();
  const returnPath = kioskConfig?.defaultMode === 'PHOTO' ? '/kiosk/photo' : '/kiosk/tag';

  const resolvedClientKey = DEFAULT_CLIENT_KEY;
  const resolvedClientId = undefined;

  const [riggingTagUid, setRiggingTagUid] = useState(searchParams.get('tagUid') ?? '');
  const [employeeTagUid, setEmployeeTagUid] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const processingRef = useRef(false);

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
                <h2 className="text-xl font-bold text-slate-900">吊具 持出</h2>
                <p className="text-sm font-semibold text-slate-700">吊具タグ → 従業員タグ の順にスキャンしてください。</p>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-600">吊具タグUID:</span>
                  <span className="font-mono font-semibold text-slate-900">{riggingTagUid || '-'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-600">従業員タグUID:</span>
                  <span className="font-mono font-semibold text-slate-900">{employeeTagUid || '-'}</span>
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
              <div className="rounded-md border-2 border-slate-300 bg-slate-100 p-3 shadow-lg">
                <p className="text-sm font-bold text-amber-600">点検見本（確認のみ）</p>
                <img
                  src="/assets/rigging-inspection.png"
                  alt="Rigging inspection reference"
                  className="mt-2 w-full max-w-none rounded-md border-2 border-slate-300 object-contain"
                />
                <p className="mt-2 text-sm font-semibold text-slate-700">画像を参照し、目視点検後にOK/NGを判断してください。</p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {message && <div className="rounded-md border-2 border-emerald-700 bg-emerald-600 p-3 text-sm font-semibold text-white shadow-lg">{message}</div>}
              {error && <div className="rounded-md border-2 border-red-700 bg-red-600 p-3 text-sm font-semibold text-white shadow-lg">{error}</div>}
              {isSubmitting && <div className="text-sm font-semibold text-slate-700">送信中…</div>}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
