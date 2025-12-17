import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useMatch, useNavigate, useSearchParams } from 'react-router-dom';

import {
  borrowMeasuringInstrument,
  createInspectionRecord,
  DEFAULT_CLIENT_KEY,
  getInspectionItems,
  getMeasuringInstrumentByTagUid,
  getMeasuringInstrumentTags,
  postClientLogs
} from '../../api/client';
import { useKioskConfig, useMeasuringInstruments } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { InspectionItem, MeasuringInstrumentBorrowPayload } from '../../api/types';
import type { AxiosError } from 'axios';

type InstrumentSource = 'select' | 'tag' | null;

export function KioskInstrumentBorrowPage() {
  const { data: instruments, isLoading: isLoadingInstruments } = useMeasuringInstruments();
  const { data: kioskConfig } = useKioskConfig();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [clientKey] = useLocalStorage('kiosk-client-key', DEFAULT_CLIENT_KEY);
  const [clientId] = useLocalStorage('kiosk-client-id', '');
  const resolvedClientKey = clientKey || DEFAULT_CLIENT_KEY;
  const resolvedClientId = clientId || undefined;

  // defaultModeに基づいて戻り先を決定
  const returnPath = kioskConfig?.defaultMode === 'PHOTO' ? '/kiosk/photo' : '/kiosk/tag';

  const [selectedInstrumentId, setSelectedInstrumentId] = useState('');
  const [instrumentSource, setInstrumentSource] = useState<InstrumentSource>(null);
  const [inspectionItems, setInspectionItems] = useState<InspectionItem[]>([]);
  const [inspectionLoading, setInspectionLoading] = useState(false);

  const [instrumentTagUid, setInstrumentTagUid] = useState('');
  const [resolvedInstrumentTagUid, setResolvedInstrumentTagUid] = useState('');
  const [employeeTagUid, setEmployeeTagUid] = useState('');
  const [note, setNote] = useState('');
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
        setIsNg(false);
        return;
      }
      setInspectionLoading(true);
      try {
        const items = await getInspectionItems(selectedInstrumentId);
        setInspectionItems(items);
        setIsNg(false); // 計測機器変更時にNGフラグをリセット
      } catch (error) {
        console.error(error);
        setMessage('点検項目の取得に失敗しました。計測機器を確認してください。');
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
    setIsNg(true);
    setIsSubmitting(true);
    setMessage(null);
    try {
      const loan = await borrowMeasuringInstrument({
        instrumentTagUid: resolvedInstrumentTagUid.trim(),
        employeeTagUid,
        note: note || undefined
      });
      // NGの場合は点検記録を作成しない（個別項目の記録は不要）
      setMessage(`持出登録完了（NG）: Loan ID = ${loan.id}`);
      resetForm();
      // defaultModeに応じた画面へ戻す
      navigate(returnPath, { replace: true });
    } catch (error) {
      console.error(error);
      setMessage('エラーが発生しました。入力値を確認してください。');
      setIsNg(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = useCallback(async (e?: FormEvent) => {
    if (e) {
      e.preventDefault();
    }
    if (!hasInstrument) {
      setMessage('計測機器を選択するかタグUIDを入力してください。');
      return;
    }
    if (!employeeTagUid.trim()) {
      setMessage('氏名タグUIDを入力してください。');
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
        note?: string;
        instrumentTagUid?: string;
        instrumentId?: string;
      } = {
        employeeTagUid,
        note: note || undefined
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
      // エラー時は自動再送を防ぐため、氏名タグをクリアして再スキャンを促す
      setEmployeeTagUid('');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    selectedInstrumentId,
    employeeTagUid,
    isNg,
    note,
    inspectionItems,
    instruments,
    hasInstrument,
    resolvedInstrumentTagUid,
    navigate,
    returnPath
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

    // 2枚目のスキャンは氏名タグとみなす
    if (!employeeTagUid) {
      setEmployeeTagUid(nfcEvent.uid);
      if (isNg || isSubmitting) {
        return;
      }
      if (!hasInstrument) {
        setMessage('計測機器を選択中です。少し待ってから再スキャンしてください。');
        return;
      }
      // OKフローは自動送信
      handleSubmit();
    }
  }, [nfcEvent, instrumentTagUid, employeeTagUid, isNg, isSubmitting, hasInstrument, handleSubmit, instrumentSource, resolvedClientId, resolvedClientKey]);

  const resetForm = () => {
    setSelectedInstrumentId('');
    setInstrumentSource(null);
    setInstrumentTagUid('');
    setResolvedInstrumentTagUid('');
    setEmployeeTagUid('');
    setNote('');
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
    <div className="flex flex-col items-center gap-6 p-6">
      <Card title="計測機器 持出">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700 md:col-span-2">
            計測機器を選択
            <div className="mt-1">
              <select
                className="w-full rounded border-2 border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                value={selectedInstrumentId}
                onChange={(e) => {
                  // 最初に操作したソースを優先する
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
          <label className="text-sm font-semibold text-slate-700">
            計測機器タグUID
            <Input
              value={instrumentTagUid}
              onChange={(e) => {
                // ドロップダウンでタグ未解決の場合は手入力を許可する
                if (instrumentSource && instrumentSource !== 'tag' && resolvedInstrumentTagUid) return;
                setInstrumentTagUid(e.target.value);
                if (!instrumentSource || instrumentSource === 'select') {
                  setInstrumentSource('tag');
                }
              }}
              required={selectedInstrumentId.trim().length === 0}
              placeholder="スキャンまたは手入力"
              disabled={instrumentSource === 'select' && Boolean(resolvedInstrumentTagUid)}
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            氏名タグUID
            <Input
              ref={employeeTagInputRef}
              value={employeeTagUid}
              onChange={(e) => setEmployeeTagUid(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isNg && !isSubmitting && employeeTagUid.trim() && hasInstrument) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              required
              placeholder="スキャンまたは手入力（OKの場合は自動送信）"
              disabled={isSubmitting || isNg}
            />
          </label>
          <label className="text-sm font-semibold text-slate-700 md:col-span-2">
            備考
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="任意" />
          </label>

          <div className="md:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">点検項目</p>
              {inspectionItems.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  className={isNg ? 'bg-red-500 text-white hover:bg-red-600' : undefined}
                  onClick={handleNg}
                  disabled={isSubmitting || !hasInstrument || !employeeTagUid.trim()}
                >
                  NGにする
                </Button>
              )}
            </div>
            {inspectionLoading ? (
              <p className="text-sm text-slate-700">点検項目を読み込み中…</p>
            ) : inspectionItems.length === 0 ? (
              <p className="text-sm text-slate-700">計測機器を選択すると点検項目が表示されます。</p>
            ) : (
              <div className="grid gap-3">
                {inspectionItems.map((item) => (
                  <div key={item.id} className="rounded border-2 border-slate-300 bg-slate-100 p-3 shadow-lg">
                    <p className="font-bold text-base text-slate-900">{item.name}</p>
                    <p className="text-sm text-slate-700">内容: {item.content}</p>
                    <p className="text-sm text-slate-700">基準: {item.criteria}</p>
                    <p className="text-sm text-slate-700">方法: {item.method}</p>
                    <p className="mt-2 text-sm font-semibold text-slate-700">
                      {isNg ? '❌ NG' : '✅ OK（氏名タグスキャンで自動送信）'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {inspectionItems.length === 0 && (
            <div className="md:col-span-2">
              <Button type="submit" disabled={isSubmitting} onClick={handleSubmit}>
                {isSubmitting ? '送信中…' : '持出登録'}
              </Button>
            </div>
          )}
        </form>
        {message ? <p className="mt-4 text-sm font-semibold text-slate-700">{message}</p> : null}
      </Card>
    </div>
  );
}
