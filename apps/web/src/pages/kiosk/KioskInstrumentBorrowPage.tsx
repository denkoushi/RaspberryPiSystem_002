import clsx from 'clsx';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useMatch, useNavigate, useSearchParams } from 'react-router-dom';

import {
  borrowMeasuringInstrument,
  createInspectionRecord,
  getResolvedClientKey,
  getMeasuringInstrumentInspectionProfile,
  getMeasuringInstrumentByTagUid,
  getMeasuringInstrumentTags,
  postClientLogs
} from '../../api/client';
import { useKioskConfig, useMeasuringInstruments } from '../../api/hooks';
import { INSTRUMENT_BORROW_FIELD_WIDTH_CLASS } from '../../components/kiosk/instrumentBorrow/formFieldClass';
import { InstrumentBorrowGenreImagesPanel } from '../../components/kiosk/instrumentBorrow/InstrumentBorrowGenreImagesPanel';
import { InstrumentBorrowHeaderRow } from '../../components/kiosk/instrumentBorrow/InstrumentBorrowHeaderRow';
import { InstrumentBorrowInspectionItemCard } from '../../components/kiosk/instrumentBorrow/InstrumentBorrowInspectionItemCard';
import { InstrumentBorrowInspectionItemsGrid } from '../../components/kiosk/instrumentBorrow/InstrumentBorrowInspectionItemsGrid';
import { InstrumentBorrowPageLayout } from '../../components/kiosk/instrumentBorrow/InstrumentBorrowPageLayout';
import { InstrumentBorrowTagUidFields } from '../../components/kiosk/instrumentBorrow/InstrumentBorrowTagUidFields';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { InspectionItem, MeasuringInstrumentBorrowPayload } from '../../api/types';
import type { AxiosError } from 'axios';

type InstrumentSource = 'select' | 'tag' | null;

export function KioskInstrumentBorrowPage() {
  const { data: instruments, isLoading: isLoadingInstruments } = useMeasuringInstruments();
  const { data: kioskConfig } = useKioskConfig();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const resolvedClientKey = getResolvedClientKey();
  const resolvedClientId = undefined;

  // defaultModeに基づいて戻り先を決定
  const returnPath = kioskConfig?.defaultMode === 'PHOTO' ? '/kiosk/photo' : '/kiosk/tag';

  const [selectedInstrumentId, setSelectedInstrumentId] = useState('');
  const [instrumentSource, setInstrumentSource] = useState<InstrumentSource>(null);
  const [inspectionItems, setInspectionItems] = useState<InspectionItem[]>([]);
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [genreImageUrls, setGenreImageUrls] = useState<string[]>([]);
  const [genreReady, setGenreReady] = useState(false);

  const [instrumentTagUid, setInstrumentTagUid] = useState('');
  const [resolvedInstrumentTagUid, setResolvedInstrumentTagUid] = useState('');
  const [employeeTagUid, setEmployeeTagUid] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isNg, setIsNg] = useState(false);
  const employeeTagInputRef = useRef<HTMLInputElement>(null);
  // スコープ分離: このページがアクティブな場合のみNFCを有効にする
  const isActiveRoute = useMatch('/kiosk/instruments/borrow');
  const nfcEvent = useNfcStream(Boolean(isActiveRoute));
  const lastNfcEventKeyRef = useRef<string | null>(null);

  const hasInstrument = selectedInstrumentId || instrumentTagUid.trim();

  const toShortMessage = (msg?: string) => {
    if (!msg) return '送信に失敗しました。再スキャンしてください。';
    const lower = msg.toLowerCase();
    if (
      msg.includes('計測機器') &&
      (msg.includes('登録されていません') || lower.includes('instrument not found'))
    ) {
      return 'タグ未登録（計測機器）';
    }
    if (
      msg.includes('従業員') &&
      (msg.includes('登録されていません') || lower.includes('employee not found'))
    ) {
      return 'タグ未登録（社員）';
    }
    if (msg.includes('貸出中') || lower.includes('already borrowed')) {
      return '既に貸出中です';
    }
    return msg.length > 40 ? '送信に失敗しました。再スキャンしてください。' : msg;
  };

  // タグUID入力時に計測機器を自動選択
  useEffect(() => {
    // URLクエリに tagUid があれば初期セット（持出タブからの誘導用）
    const initialTag = searchParams.get('tagUid');
    if (initialTag) {
      setInstrumentTagUid(initialTag);
    }
    // 一度だけ評価
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 計測機器タグ未登録で誘導された場合は明示的にエラーメッセージを表示
  useEffect(() => {
    if (searchParams.get('notFound') === '1') {
      setMessage('タグ未登録（計測機器）');
    }
  }, [searchParams]);

  useEffect(() => {
    const searchInstrumentByTag = async () => {
      if (!instrumentTagUid || instrumentTagUid.trim().length === 0) {
        setResolvedInstrumentTagUid('');
        if (instrumentSource !== 'select') {
          setSelectedInstrumentId('');
        }
        return;
      }
      try {
        setResolvedInstrumentTagUid(instrumentTagUid.trim());
        const instrument = await getMeasuringInstrumentByTagUid(instrumentTagUid.trim());
        if (instrument && instrument.id !== selectedInstrumentId) {
          setSelectedInstrumentId(instrument.id);
          if (!instrumentSource) {
            setInstrumentSource('tag');
          }
        }
      } catch (error) {
        // タグUIDが見つからない場合はエラーを表示しない（手動選択も可能なため）
        console.debug('Tag UID not found:', instrumentTagUid);
        if (instrumentSource !== 'select') {
          setSelectedInstrumentId('');
        }
      }
    };

    // デバウンス: 500ms後に検索
    const timeoutId = setTimeout(searchInstrumentByTag, 500);
    return () => clearTimeout(timeoutId);
  }, [instrumentTagUid, selectedInstrumentId, instrumentSource]);

  // ドロップダウン選択時、最初のタグを自動解決する
  useEffect(() => {
    const resolveTagFromSelection = async () => {
      if (!selectedInstrumentId || instrumentSource !== 'select') {
        return;
      }
      try {
        const { tags } = await getMeasuringInstrumentTags(selectedInstrumentId);
        const firstTag = tags?.[0]?.rfidTagUid ?? '';
        setResolvedInstrumentTagUid(firstTag);
        setInstrumentTagUid(firstTag);
        // タグ未登録でもドロップダウン選択で進めるため、メッセージのみ表示
        if (!firstTag) {
          setMessage('計測機器のタグが未登録です。タグを紐付けるか、このまま氏名タグをスキャンしてください。');
        } else {
          setMessage(null);
        }
      } catch (error) {
        console.error(error);
        // タグ取得失敗時も計測機器IDで進める
        setMessage('計測機器タグの取得に失敗しました。氏名タグをスキャンして続行できます。');
      }
    };
    resolveTagFromSelection();
  }, [selectedInstrumentId, instrumentSource]);

  // 選択された計測機器に紐づく点検項目を取得
  useEffect(() => {
    const fetchInspectionItems = async () => {
      if (!selectedInstrumentId) {
        setInspectionItems([]);
        setGenreImageUrls([]);
        setGenreReady(false);
        setIsNg(false);
        return;
      }
      setInspectionLoading(true);
      setInspectionItems([]);
      setGenreImageUrls([]);
      setGenreReady(false);
      setIsNg(false);
      try {
        const profile = await getMeasuringInstrumentInspectionProfile(selectedInstrumentId);
        setInspectionItems(profile.inspectionItems);
        const images = [profile.genre?.imageUrlPrimary, profile.genre?.imageUrlSecondary].filter(
          (image): image is string => typeof image === 'string' && image.length > 0
        );
        setGenreImageUrls(images);
        setGenreReady(Boolean(profile.genre) && images.length > 0);
        if (!profile.genre) {
          setMessage('計測機器ジャンルが未設定のため、持出できません。管理コンソールで設定してください。');
        } else if (images.length === 0) {
          setMessage('計測機器ジャンル画像が未設定のため、持出できません。管理コンソールで設定してください。');
        } else {
          setMessage(null);
        }
        setIsNg(false); // 計測機器変更時にNGフラグをリセット
      } catch (error) {
        console.error(error);
        setGenreReady(false);
        setMessage('点検項目/ジャンル設定の取得に失敗しました。計測機器を確認してください。');
      } finally {
        setInspectionLoading(false);
      }
    };
    fetchInspectionItems();
  }, [selectedInstrumentId]);

  // 計測機器選択後、氏名タグ入力欄にフォーカス（タグ解決後も再度フォーカス）
  useEffect(() => {
    if (selectedInstrumentId && !isNg) {
      setTimeout(() => {
        employeeTagInputRef.current?.focus();
      }, 0);
    }
  }, [selectedInstrumentId, resolvedInstrumentTagUid, instrumentSource, isNg]);

  const handleNg = async () => {
    if (!hasInstrument) {
      setMessage('計測機器を選択するかタグUIDを入力してください。');
      return;
    }
    if (!resolvedInstrumentTagUid.trim()) {
      setMessage('計測機器のタグが未登録です。タグを紐付けてください。');
      return;
    }
    if (!employeeTagUid.trim()) {
      setMessage('氏名タグUIDを入力してください。');
      return;
    }
    if (!genreReady) {
      setMessage('計測機器ジャンルまたは点検画像が未設定のため、持出できません。管理コンソールで設定してください。');
      return;
    }
    setIsNg(true);
    setIsSubmitting(true);
    setMessage(null);
    try {
      const loan = await borrowMeasuringInstrument({
        instrumentTagUid: resolvedInstrumentTagUid.trim(),
        employeeTagUid
      });
      // NGの場合は点検記録を作成しない（個別項目の記録は不要）
      setMessage(`持出登録完了（NG）: Loan ID = ${loan.id}`);
      resetForm();
      // defaultModeに応じた画面へ戻す
      navigate(returnPath, { replace: true });
    } catch (error) {
      console.error(error);
      const apiErr = error as Partial<AxiosError<{ message?: string }>>;
      const apiMessage: string | undefined = apiErr.response?.data?.message;
      const errorMessage = apiMessage || apiErr?.message || 'エラーが発生しました。入力値を確認してください。';
      setMessage(errorMessage);
      setIsNg(false);
      
      // エラーログをサーバーに送信
      postClientLogs(
        {
          clientId: resolvedClientId || 'raspberrypi4-kiosk1',
          logs: [
            {
              level: 'ERROR',
              message: `instrument-borrow NG failed: ${errorMessage}`,
              context: {
                selectedInstrumentId,
                employeeTagUid,
                isNg: true,
                error: {
                  message: apiErr?.message,
                  status: apiErr?.response?.status,
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
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = useCallback(async (e?: FormEvent, employeeTagUidOverride?: string) => {
    if (e) {
      e.preventDefault();
    }
    const effectiveEmployeeUid = (employeeTagUidOverride ?? employeeTagUid).trim();
    if (!hasInstrument) {
      setMessage('計測機器を選択するかタグUIDを入力してください。');
      return;
    }
    if (!effectiveEmployeeUid) {
      setMessage('氏名タグUIDを入力してください。');
      return;
    }
    if (!genreReady) {
      setMessage('計測機器ジャンルまたは点検画像が未設定のため、持出できません。管理コンソールで設定してください。');
      return;
    }
    if (isNg) {
      // NGの場合はhandleNgで処理済み
      return;
    }
    // タグ未登録でも計測機器IDで進める
    setIsSubmitting(true);
    setMessage(null);
    try {
      // undefinedを明示的に渡さず、存在するものだけを送る
      const payload: {
        employeeTagUid: string;
        instrumentTagUid?: string;
        instrumentId?: string;
      } = {
        employeeTagUid: effectiveEmployeeUid
      };
      const tagUid = resolvedInstrumentTagUid.trim();
      if (tagUid) {
        payload.instrumentTagUid = tagUid;
      } else if (selectedInstrumentId) {
        payload.instrumentId = selectedInstrumentId;
      }

      const loan = await borrowMeasuringInstrument(payload as MeasuringInstrumentBorrowPayload);
      // OKの場合：全項目PASSとして点検記録を作成
      const selectedInstrument = instruments?.find((inst) => inst.id === selectedInstrumentId);
      if (inspectionItems.length > 0 && selectedInstrument && loan.employee?.id) {
        const tasks = inspectionItems.map((item) =>
          createInspectionRecord({
            measuringInstrumentId: selectedInstrument.id,
            loanId: loan.id,
            employeeId: loan.employee.id,
            inspectionItemId: item.id,
            result: 'PASS',
            inspectedAt: new Date().toISOString()
          })
        );
        await Promise.all(tasks);
      }
      setMessage(`持出登録完了: Loan ID = ${loan.id}`);
      resetForm();
      // defaultModeに応じた画面へ戻す
      navigate(returnPath, { replace: true });
    } catch (error) {
      console.error(error);
      const apiErr = error as Partial<AxiosError<{ message?: string }>>;
      const apiMessage: string | undefined = apiErr.response?.data?.message;
      const rawMessage =
        typeof apiMessage === 'string' && apiMessage.length > 0 ? apiMessage : apiErr?.message;
      setMessage(toShortMessage(rawMessage));
      
      // エラーログをサーバーに送信
      postClientLogs(
        {
          clientId: resolvedClientId || 'raspberrypi4-kiosk1',
          logs: [
            {
              level: 'ERROR',
              message: `instrument-borrow failed: ${rawMessage || 'Unknown error'}`,
              context: {
                selectedInstrumentId,
                employeeTagUid: effectiveEmployeeUid,
                resolvedInstrumentTagUid,
                payload: {
                  employeeTagUid: effectiveEmployeeUid,
                  instrumentTagUid: resolvedInstrumentTagUid.trim() || undefined,
                  instrumentId: selectedInstrumentId || undefined
                },
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
      
      // エラー時は自動再送を防ぐため、氏名タグをクリアして再スキャンを促す
      setEmployeeTagUid('');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    selectedInstrumentId,
    employeeTagUid,
    isNg,
    inspectionItems,
    genreReady,
    instruments,
    hasInstrument,
    resolvedInstrumentTagUid,
    navigate,
    returnPath,
    resolvedClientId,
    resolvedClientKey
  ]);

  // NFCエージェントのイベントを処理（計測機器→氏名タグの順で自動送信）
  useEffect(() => {
    if (!nfcEvent) return;

    const eventKey = `${nfcEvent.uid}:${nfcEvent.timestamp}`;
    if (lastNfcEventKeyRef.current === eventKey) {
      return;
    }
    lastNfcEventKeyRef.current = eventKey;

    // デバッグログをサーバーに送信
    const isFirstScan = !instrumentTagUid && (!instrumentSource || instrumentSource === 'tag');
    postClientLogs(
      {
        clientId: resolvedClientId || 'raspberrypi4-kiosk1',
        logs: [
          {
            level: 'DEBUG',
            message: 'instrument-page nfc event',
            context: { uid: nfcEvent.uid, isFirstScan, hasInstrument }
          }
        ]
      },
      resolvedClientKey
    ).catch(() => {});

    // 1枚目のスキャンは計測機器タグとみなす（ただし最初に選択したソースを尊重）
    if (isFirstScan) {
      setInstrumentTagUid(nfcEvent.uid);
      setResolvedInstrumentTagUid(nfcEvent.uid);
      setInstrumentSource('tag');
      setMessage('計測機器タグを読み取りました。氏名タグをスキャンしてください。');
      return;
    }

    // 2枚目のスキャンは氏名タグとみなす（setStateは次描画まで反映されないため、APIは nfcEvent.uid を明示渡しする）
    if (!employeeTagUid) {
      setEmployeeTagUid(nfcEvent.uid);
      if (isNg || isSubmitting) {
        return;
      }
      if (!hasInstrument) {
        setMessage('計測機器を選択中です。少し待ってから再スキャンしてください。');
        return;
      }
      void handleSubmit(undefined, nfcEvent.uid);
    }
  }, [nfcEvent, instrumentTagUid, employeeTagUid, isNg, isSubmitting, hasInstrument, handleSubmit, instrumentSource, resolvedClientId, resolvedClientKey]);

  const resetForm = () => {
    setSelectedInstrumentId('');
    setInstrumentSource(null);
    setInstrumentTagUid('');
    setResolvedInstrumentTagUid('');
    setEmployeeTagUid('');
    setInspectionItems([]);
    setIsNg(false);
  };

  // 氏名タグUID入力時に自動送信（OKの場合のみ）
  useEffect(() => {
    if (
      !employeeTagUid.trim() ||
      !hasInstrument ||
      isNg ||
      isSubmitting
    ) {
      return;
    }
    // デバウンス: 500ms後に自動送信
    const timeoutId = setTimeout(() => {
      handleSubmit();
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [employeeTagUid, hasInstrument, isNg, isSubmitting, handleSubmit, resolvedInstrumentTagUid]);

  return (
    <div className="flex h-dvh min-h-0 flex-col gap-6 p-6">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <InstrumentBorrowPageLayout
          header={
            <InstrumentBorrowHeaderRow
              title="計測機器 持出"
              statusMessage={message}
              trailing={
                inspectionItems.length > 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className={clsx('rounded-lg px-[18px] py-2 text-sm', isNg && 'bg-red-500 text-white hover:bg-red-600')}
                    onClick={handleNg}
                    disabled={isSubmitting || !hasInstrument || !employeeTagUid.trim() || !genreReady}
                  >
                    NGにする
                  </Button>
                ) : undefined
              }
            />
          }
          leftColumn={
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <label className={clsx('block text-sm font-semibold text-slate-700', INSTRUMENT_BORROW_FIELD_WIDTH_CLASS)}>
                計測機器を選択
                <div className="mt-1">
                  <select
                    className="w-full rounded-md border-2 border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    value={selectedInstrumentId}
                    onChange={(e) => {
                      if (instrumentSource && instrumentSource !== 'select') return;
                      setSelectedInstrumentId(e.target.value);
                      setInstrumentSource('select');
                    }}
                    required={instrumentTagUid.trim().length === 0}
                    disabled={isLoadingInstruments || instrumentSource === 'tag'}
                  >
                    <option value="">選択してください</option>
                    {instruments?.map((instrument) => (
                      <option key={instrument.id} value={instrument.id}>
                        {instrument.name}（{instrument.managementNumber}）
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <InstrumentBorrowTagUidFields
                instrumentTagUid={instrumentTagUid}
                onInstrumentTagUidChange={(value) => {
                  if (instrumentSource && instrumentSource !== 'tag' && resolvedInstrumentTagUid) return;
                  setInstrumentTagUid(value);
                  if (!instrumentSource || instrumentSource === 'select') {
                    setInstrumentSource('tag');
                  }
                }}
                instrumentInputDisabled={instrumentSource === 'select' && Boolean(resolvedInstrumentTagUid)}
                instrumentRequired={selectedInstrumentId.trim().length === 0}
                employeeTagUid={employeeTagUid}
                onEmployeeTagUidChange={setEmployeeTagUid}
                onEmployeeKeyDown={(e) => {
                  if (e.key === 'Enter' && !isNg && !isSubmitting && employeeTagUid.trim() && hasInstrument) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                employeeInputRef={employeeTagInputRef}
                employeeInputDisabled={isSubmitting || isNg}
              />

              <p className="mt-2 w-full text-sm font-semibold text-slate-700">点検項目</p>

              <div className="mt-1 flex w-full flex-col gap-2">
                {inspectionLoading ? (
                  <p className="text-sm text-slate-700">点検項目を読み込み中…</p>
                ) : inspectionItems.length === 0 ? (
                  <p className="text-sm text-slate-700">計測機器を選択すると点検項目が表示されます。</p>
                ) : (
                  <InstrumentBorrowInspectionItemsGrid>
                    {inspectionItems.map((item) => (
                      <InstrumentBorrowInspectionItemCard key={item.id} item={item} isNg={isNg} />
                    ))}
                  </InstrumentBorrowInspectionItemsGrid>
                )}
              </div>

              {inspectionItems.length === 0 && (
                <div>
                  <Button type="submit" disabled={isSubmitting || !genreReady} onClick={handleSubmit}>
                    {isSubmitting ? '送信中…' : '持出登録'}
                  </Button>
                </div>
              )}
            </form>
          }
          rightColumn={<InstrumentBorrowGenreImagesPanel imageUrls={genreImageUrls} />}
        />
      </Card>
    </div>
  );
}
