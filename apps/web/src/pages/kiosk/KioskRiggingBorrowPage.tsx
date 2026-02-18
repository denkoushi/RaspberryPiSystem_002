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

import type { RiggingGear } from '../../api/types';

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

  const [riggingGear, setRiggingGear] = useState<RiggingGear | null>(null);
  const [isRiggingGearLoading, setIsRiggingGearLoading] = useState(false);
  const [riggingGearError, setRiggingGearError] = useState<string | null>(null);

  // NFCイベント処理は同一イベントを二重処理しないことが重要なため、最新state参照はrefで行う
  const riggingGearRef = useRef<RiggingGear | null>(null);
  const riggingGearErrorRef = useRef<string | null>(null);
  useEffect(() => {
    riggingGearRef.current = riggingGear;
  }, [riggingGear]);
  useEffect(() => {
    riggingGearErrorRef.current = riggingGearError;
  }, [riggingGearError]);

  // 吊具タグUIDが決まった時点で、吊具マスタ情報を先読みして表示に使う
  useEffect(() => {
    let cancelled = false;
    const tagUid = riggingTagUid.trim();
    if (!tagUid) {
      setRiggingGear(null);
      setRiggingGearError(null);
      setIsRiggingGearLoading(false);
      return;
    }

    setIsRiggingGearLoading(true);
    setRiggingGearError(null);
    getRiggingGearByTagUid(tagUid)
      .then((gear) => {
        if (cancelled) return;
        setRiggingGear(gear);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        const apiMessage =
          axios.isAxiosError(err) && err.response?.data && typeof err.response.data === 'object'
            ? (err.response.data as { message?: string }).message
            : undefined;
        const msg =
          status === 404
            ? 'タグ未登録（吊具）'
            : typeof apiMessage === 'string' && apiMessage.length > 0
            ? apiMessage
            : err instanceof Error
            ? err.message
            : '吊具情報の取得に失敗しました';
        setRiggingGear(null);
        setRiggingGearError(msg);
      })
      .finally(() => {
        if (cancelled) return;
        setIsRiggingGearLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [riggingTagUid]);

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

          // すでに取得済みの吊具情報があれば再利用し、不要なAPI二重呼び出しを避ける
          const latestGear = riggingGearRef.current;
          const latestGearError = riggingGearErrorRef.current;
          const gear =
            latestGear ??
            (latestGearError
              ? null
              : await getRiggingGearByTagUid(riggingTagUid));
          if (!gear) {
            // 表示用の取得で404を掴んでいる場合は、送信時は従来の短い文言に揃える
            if (latestGearError === 'タグ未登録（吊具）') {
              throw new Error('吊具が登録されていません');
            }
            throw new Error(latestGearError || '吊具が登録されていません');
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
                      setRiggingGear(null);
                      setRiggingGearError(null);
                      setIsRiggingGearLoading(false);
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
              <div className="rounded-md border-2 border-slate-300 bg-white p-3 shadow-lg">
                <h3 className="text-xl font-bold text-slate-900">吊具持出</h3>
                <div className="mt-2 text-sm">
                  {!riggingTagUid ? (
                    <p className="font-semibold text-slate-600">吊具タグをスキャンしてください</p>
                  ) : isRiggingGearLoading ? (
                    <p className="font-semibold text-slate-600">吊具情報を取得中…</p>
                  ) : riggingGearError ? (
                    <p className="font-semibold text-red-600">{riggingGearError}</p>
                  ) : riggingGear ? (
                    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                      <dt className="font-semibold text-slate-600">名称</dt>
                      <dd className="font-semibold text-slate-900">{riggingGear.name || '-'}</dd>

                      <dt className="font-semibold text-slate-600">管理番号</dt>
                      <dd className="font-semibold text-slate-900">{riggingGear.managementNumber || '-'}</dd>

                      <dt className="font-semibold text-slate-600">保管場所</dt>
                      <dd className="font-semibold text-slate-900">{riggingGear.storageLocation ?? '-'}</dd>

                      <dt className="font-semibold text-slate-600">荷重(t)</dt>
                      <dd className="font-semibold text-slate-900">
                        {typeof riggingGear.maxLoadTon === 'number' ? `${riggingGear.maxLoadTon} t` : '-'}
                      </dd>

                      <dt className="font-semibold text-slate-600">長さ/幅/厚み</dt>
                      <dd className="font-semibold text-slate-900">
                        {riggingGear.lengthMm != null || riggingGear.widthMm != null || riggingGear.thicknessMm != null
                          ? `${riggingGear.lengthMm ?? '-'} / ${riggingGear.widthMm ?? '-'} / ${riggingGear.thicknessMm ?? '-'} mm`
                          : '-'}
                      </dd>
                    </dl>
                  ) : (
                    <p className="font-semibold text-slate-600">吊具情報なし</p>
                  )}
                </div>
              </div>
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
