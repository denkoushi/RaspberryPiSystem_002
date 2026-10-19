import { useEffect, useMemo, useState } from 'react';

import { getApiErrorMessage } from '../../../api/errors';
import { useSignageScheduleMutations } from '../../../api/hooks';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { resolveSignageTargetClientCandidates } from '../../../lib/signageTargetClientDevices';
import { SelfInspectionMachineBoardFields } from '../signage/SelfInspectionMachineBoardFields';
import { DAYS_OF_WEEK, parseResourceCdListInput } from '../signage/signageScheduleDisplay';

import { BUILTIN_DATA_ITEMS } from './hubModel';
import { PanelFrame } from './PanelFrame';
import {
  decodeContentChoice,
  EVERY_DAY,
  fullChoiceValue,
  fullKindHasDetailFields,
  sameDays,
  splitChoiceValue,
  validateScheduleDraft,
  WEEKDAYS,
} from './scheduleDraftModel';

import type { useSignageScheduleEditor } from '../signage/useSignageScheduleEditor';

type Editor = ReturnType<typeof useSignageScheduleEditor>;

/** 月曜始まりで並べた曜日ボタン */
const DAY_BUTTONS = [1, 2, 3, 4, 5, 6, 0].map((value) => DAYS_OF_WEEK.find((day) => day.value === value)!);

function ContentSelect({
  id,
  label,
  value,
  onChange,
  editor,
  allowFullOnly,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  editor: Editor;
  /** 全体表示だけで選べるもの（ページ撮影、キオスク系のボード）も出すか */
  allowFullOnly: boolean;
}) {
  const builtin = allowFullOnly ? BUILTIN_DATA_ITEMS : BUILTIN_DATA_ITEMS.filter((item) => item.kind === 'loans');
  return (
    <div className="sh-fld">
      <label className="sh-flbl" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="sh-input sh-select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">選んでください</option>
        {allowFullOnly && (editor.webCapturesQuery.data?.length ?? 0) > 0 && (
          <optgroup label="ページ撮影">
            {editor.webCapturesQuery.data?.map((capture) => (
              <option key={capture.id} value={`web_page:${capture.id}`}>
                {capture.name}
                {capture.enabled ? '' : '（無効）'}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="データ">
          {builtin.map((item) => (
            <option key={item.kind} value={`builtin:${item.kind}`}>
              {item.name}
            </option>
          ))}
          {editor.visualizationDashboardsQuery.data?.map((dashboard) => (
            <option key={dashboard.id} value={`visualization:${dashboard.id}`}>
              {dashboard.name}
              {dashboard.enabled ? '' : '（無効）'}
            </option>
          ))}
          {editor.csvDashboardsQuery.data?.map((dashboard) => (
            <option key={dashboard.id} value={`csv_dashboard:${dashboard.id}`}>
              {dashboard.name}（表）
            </option>
          ))}
        </optgroup>
        {(editor.pdfsQuery.data?.length ?? 0) > 0 && (
          <optgroup label="PDF">
            {editor.pdfsQuery.data?.map((pdf) => (
              <option key={pdf.id} value={`pdf:${pdf.id}`}>
                {pdf.name}
                {pdf.enabled ? '' : '（無効）'}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}

function DetailNumber({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="sh-fld">
      <label className="sh-flbl" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="sh-input sh-mono" inputMode="numeric" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * 予定の追加・編集。入力部品は新しい見た目だが、状態と保存内容の組み立ては
 * 既存の useSignageScheduleEditor / signageLayoutConfigModel をそのまま使う（保存形式は変えない）。
 */
export function SchedulePanel({ editor }: { editor: Editor }) {
  const confirm = useConfirm();
  const { remove } = useSignageScheduleMutations();
  const [validationError, setValidationError] = useState<string | null>(null);
  const { editingId, formData, setFormData, layoutType } = editor;
  const isChatLayout = editor.preservedCanvasLayoutConfig !== null;

  // 旧形式（layoutConfig なし）の予定も、開いたら新形式として扱う。Chat で作った画面は中身に触れない。
  const { useNewLayout, setUseNewLayout } = editor;
  useEffect(() => {
    if (!isChatLayout && !useNewLayout) setUseNewLayout(true);
  }, [isChatLayout, useNewLayout, setUseNewLayout]);

  const fullValue = fullChoiceValue(editor);
  const leftValue = splitChoiceValue(editor.leftSlotKind, {
    pdfId: editor.leftPdfId,
    csvDashboardId: editor.leftCsvDashboardId,
    visualizationDashboardId: editor.leftVisualizationDashboardId,
  });
  const rightValue = splitChoiceValue(editor.rightSlotKind, {
    pdfId: editor.rightPdfId,
    csvDashboardId: editor.rightCsvDashboardId,
    visualizationDashboardId: editor.rightVisualizationDashboardId,
  });

  const handleFullChange = (value: string) => {
    const choice = decodeContentChoice(value);
    editor.resetFullSlotSpecificFields();
    if (!choice) {
      editor.setFullSlotKind('web_page');
      return;
    }
    if (choice.type === 'builtin') editor.setFullSlotKind(choice.kind);
    else if (choice.type === 'web_page') {
      editor.setFullSlotKind('web_page');
      editor.setFullWebCaptureId(choice.id);
    } else if (choice.type === 'pdf') {
      editor.setFullSlotKind('pdf');
      editor.setFullPdfId(choice.id);
    } else if (choice.type === 'csv_dashboard') {
      editor.setFullSlotKind('csv_dashboard');
      editor.setFullCsvDashboardId(choice.id);
    } else {
      editor.setFullSlotKind('visualization');
      editor.setFullVisualizationDashboardId(choice.id);
    }
  };

  const handleSideChange = (side: 'left' | 'right', value: string) => {
    const choice = decodeContentChoice(value);
    const setKind = side === 'left' ? editor.setLeftSlotKind : editor.setRightSlotKind;
    const setPdf = side === 'left' ? editor.setLeftPdfId : editor.setRightPdfId;
    const setCsv = side === 'left' ? editor.setLeftCsvDashboardId : editor.setRightCsvDashboardId;
    const setViz = side === 'left' ? editor.setLeftVisualizationDashboardId : editor.setRightVisualizationDashboardId;
    setPdf(null);
    setCsv(null);
    setViz(null);
    if (!choice || choice.type === 'builtin' || choice.type === 'web_page') {
      setKind(choice ? 'loans' : 'pdf');
      return;
    }
    if (choice.type === 'pdf') {
      setKind('pdf');
      setPdf(choice.id);
    } else if (choice.type === 'csv_dashboard') {
      setKind('csv_dashboard');
      setCsv(choice.id);
    } else {
      setKind('visualization');
      setViz(choice.id);
    }
  };

  const days = formData.dayOfWeek ?? [];
  const targetKeys = useMemo(() => formData.targetClientKeys ?? [], [formData.targetClientKeys]);
  const clientCandidates = useMemo(
    () => resolveSignageTargetClientCandidates(editor.clientsForSignageQuery.data ?? [], targetKeys),
    [editor.clientsForSignageQuery.data, targetKeys],
  );
  const toggleClient = (apiKey: string) => {
    const next = targetKeys.includes(apiKey) ? targetKeys.filter((key) => key !== apiKey) : [...targetKeys, apiKey];
    setFormData({ ...formData, targetClientKeys: next });
  };

  const isSaving = editor.create.isPending || editor.update.isPending;
  const saveError = editor.create.isError
    ? getApiErrorMessage(editor.create.error, '保存できませんでした')
    : editor.update.isError
      ? getApiErrorMessage(editor.update.error, '保存できませんでした')
      : null;

  const handleSave = () => {
    const error = validateScheduleDraft({
      name: formData.name,
      dayOfWeek: formData.dayOfWeek,
      startTime: formData.startTime,
      endTime: formData.endTime,
      isChatLayout,
      layoutType,
      fullChoice: fullValue,
      leftChoice: leftValue,
      rightChoice: rightValue,
      fullSlotKind: editor.fullSlotKind,
      kioskDeviceScopeKey: editor.fullKioskDeviceScopeKey,
      leaderOrderDeviceScopeKey: editor.fullLeaderOrderDeviceScopeKey,
      leaderOrderResourceCdsText: editor.fullLeaderOrderResourceCdsText,
      selfInspectionTargetMode: editor.fullSelfInspectionTargetMode,
      selfInspectionMachineName: editor.fullSelfInspectionMachineName,
    });
    setValidationError(error);
    if (!error) void editor.handleSave();
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'この予定を削除しますか？',
      description: `「${formData.name ?? ''}」を削除します。元に戻せません。`,
      confirmLabel: '削除する',
      tone: 'danger',
    });
    if (!ok) return;
    await remove.mutateAsync(id);
    editor.handleCancel();
  };

  const isFullData = !isChatLayout && layoutType === 'FULL';
  const hasKindDetails = isFullData && fullKindHasDetailFields(editor.fullSlotKind);
  const needsDetailInput =
    hasKindDetails &&
    ((editor.fullSlotKind === 'kiosk_progress_overview' && editor.fullKioskDeviceScopeKey.trim() === '') ||
      (editor.fullSlotKind === 'kiosk_leader_order_cards' &&
        (editor.fullLeaderOrderDeviceScopeKey.trim() === '' ||
          parseResourceCdListInput(editor.fullLeaderOrderResourceCdsText).length === 0)));

  return (
    <PanelFrame
      title={editor.isCreating ? '予定を追加' : '予定を編集'}
      onBack={editor.handleCancel}
      headerAction={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            role="switch"
            aria-checked={formData.enabled ?? true}
            className="sh-switch"
            onClick={() => setFormData({ ...formData, enabled: !(formData.enabled ?? true) })}
          >
            <span className="sh-switch-label">有効</span>
            <span className="sh-switch-track" aria-hidden="true">
              <span />
            </span>
          </button>
          {editingId && (
            <button type="button" className="sh-icon-btn" style={{ color: '#ff8a8a' }} aria-label="この予定を削除" onClick={() => void handleDelete(editingId)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M6 6l1 14h10l1-14" />
              </svg>
            </button>
          )}
        </div>
      }
      footer={
        <>
          <button type="button" className="sh-btn" style={{ flex: 1 }} onClick={editor.handleCancel} disabled={isSaving}>
            取り消す
          </button>
          <button type="button" className="sh-btn sh-btn-light" style={{ flex: 2 }} onClick={handleSave} disabled={isSaving}>
            {isSaving ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <div className="sh-fld">
        <label className="sh-flbl" htmlFor="sh-sc-name">
          名前
        </label>
        <input id="sh-sc-name" className="sh-input" value={formData.name ?? ''} onChange={(e) => setFormData({ ...formData, name: e.target.value })} maxLength={80} />
      </div>

      {isChatLayout ? (
        <p className="sh-hint" style={{ margin: 0 }}>
          Chat で作った画面です。表示する中身は Chat から変更します。ここでは曜日・時間・端末を変えられます。
        </p>
      ) : (
        <>
          <div className="sh-fld">
            <span className="sh-flbl">画面の分け方</span>
            <div className="sh-layouts">
              <button type="button" className="sh-layout" aria-pressed={layoutType === 'FULL'} onClick={() => editor.setLayoutType('FULL')}>
                <span className="sh-layout-icon" aria-hidden="true">
                  <i />
                </span>
                全体
              </button>
              <button type="button" className="sh-layout" aria-pressed={layoutType === 'SPLIT'} onClick={() => editor.setLayoutType('SPLIT')}>
                <span className="sh-layout-icon" aria-hidden="true">
                  <i />
                  <i />
                </span>
                左右に分割
              </button>
            </div>
          </div>

          {layoutType === 'FULL' ? (
            <ContentSelect id="sh-sc-full" label="表示するもの" value={fullValue} onChange={handleFullChange} editor={editor} allowFullOnly />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              <ContentSelect id="sh-sc-left" label="左" value={leftValue} onChange={(value) => handleSideChange('left', value)} editor={editor} allowFullOnly={false} />
              <ContentSelect id="sh-sc-right" label="右" value={rightValue} onChange={(value) => handleSideChange('right', value)} editor={editor} allowFullOnly={false} />
            </div>
          )}
        </>
      )}

      <div className="sh-fld">
        <div className="sh-row-between">
          <span className="sh-flbl">曜日</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="sh-pill sh-pill-sm" aria-pressed={sameDays(days, WEEKDAYS)} onClick={() => setFormData({ ...formData, dayOfWeek: WEEKDAYS })}>
              平日
            </button>
            <button type="button" className="sh-pill sh-pill-sm" aria-pressed={sameDays(days, EVERY_DAY)} onClick={() => setFormData({ ...formData, dayOfWeek: EVERY_DAY })}>
              毎日
            </button>
          </span>
        </div>
        <div className="sh-days">
          {DAY_BUTTONS.map((day) => (
            <button key={day.value} type="button" className="sh-day" aria-pressed={days.includes(day.value)} aria-label={`${day.label}曜`} onClick={() => editor.toggleDayOfWeek(day.value)}>
              {day.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sh-fld">
        <span className="sh-flbl">時間</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="time" className="sh-input sh-time sh-mono" aria-label="始まりの時刻" value={formData.startTime ?? ''} onChange={(e) => setFormData({ ...formData, startTime: e.target.value })} />
          <span style={{ color: 'var(--sh-faint)' }} aria-hidden="true">
            →
          </span>
          <input type="time" className="sh-input sh-time sh-mono" aria-label="終わりの時刻" value={formData.endTime ?? ''} onChange={(e) => setFormData({ ...formData, endTime: e.target.value })} />
        </div>
      </div>

      <div className="sh-fld">
        <span className="sh-flbl">表示する端末</span>
        <div className="sh-filter">
          <button type="button" className="sh-pill" aria-pressed={targetKeys.length === 0} onClick={() => setFormData({ ...formData, targetClientKeys: [] })}>
            すべての端末
          </button>
          {clientCandidates.map((client) => (
            <button key={client.id} type="button" className="sh-pill" aria-pressed={targetKeys.includes(client.apiKey)} onClick={() => toggleClient(client.apiKey)}>
              {client.name}
            </button>
          ))}
        </div>
      </div>

      <details className="sh-details" open={needsDetailInput || undefined}>
        <summary>詳しい設定{hasKindDetails ? '（このボードの設定を含む）' : ''}</summary>
        <div className="sh-col" style={{ gap: 14, paddingTop: 12 }}>
          <div className="sh-fld">
            <label className="sh-flbl" htmlFor="sh-sc-priority">
              優先順位（大きいほど先。予定のない時間に出すものもこれで決まる）
            </label>
            <input
              id="sh-sc-priority"
              type="number"
              className="sh-input sh-mono"
              value={formData.priority ?? 0}
              onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value, 10) || 0 })}
            />
          </div>

          {isFullData && editor.fullSlotKind === 'kiosk_progress_overview' && (
            <>
              <div className="sh-fld">
                <label className="sh-flbl" htmlFor="sh-sc-kiosk-scope">
                  スコープキー（キオスク端末と同じ文字列・必須）
                </label>
                <input id="sh-sc-kiosk-scope" className="sh-input sh-mono" value={editor.fullKioskDeviceScopeKey} onChange={(e) => editor.setFullKioskDeviceScopeKey(e.target.value)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                <DetailNumber id="sh-sc-kiosk-slide" label="ページ表示秒" value={editor.fullKioskSlideIntervalStr} onChange={editor.setFullKioskSlideIntervalStr} placeholder="30" />
                <DetailNumber id="sh-sc-kiosk-per" label="1ページの製番数（最大8）" value={editor.fullKioskSeibanPerPageStr} onChange={editor.setFullKioskSeibanPerPageStr} placeholder="8" />
              </div>
            </>
          )}

          {isFullData && editor.fullSlotKind === 'kiosk_leader_order_cards' && (
            <>
              <div className="sh-fld">
                <label className="sh-flbl" htmlFor="sh-sc-lo-scope">
                  スコープキー（キオスク端末と同じ文字列・必須）
                </label>
                <input id="sh-sc-lo-scope" className="sh-input sh-mono" value={editor.fullLeaderOrderDeviceScopeKey} onChange={(e) => editor.setFullLeaderOrderDeviceScopeKey(e.target.value)} />
              </div>
              <div className="sh-fld">
                <label className="sh-flbl" htmlFor="sh-sc-lo-cds">
                  資源CD（1行に1件、またはカンマ区切り・最大32件・この順に表示）
                </label>
                <textarea
                  id="sh-sc-lo-cds"
                  className="sh-textarea sh-mono"
                  style={{ fontWeight: 400, fontSize: 13 }}
                  rows={4}
                  value={editor.fullLeaderOrderResourceCdsText}
                  onChange={(e) => editor.setFullLeaderOrderResourceCdsText(e.target.value)}
                />
                <span className="sh-hint">いま {parseResourceCdListInput(editor.fullLeaderOrderResourceCdsText).length} 件</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                <DetailNumber id="sh-sc-lo-slide" label="ページ切替え秒" value={editor.fullLeaderOrderSlideIntervalStr} onChange={editor.setFullLeaderOrderSlideIntervalStr} placeholder="30" />
                <DetailNumber id="sh-sc-lo-per" label="1ページのカード数（最大10）" value={editor.fullLeaderOrderCardsPerPageStr} onChange={editor.setFullLeaderOrderCardsPerPageStr} placeholder="10" />
              </div>
            </>
          )}

          {isFullData && editor.fullSlotKind === 'mobile_placement_parts_shelf_grid' && (
            <DetailNumber id="sh-sc-shelf-max" label="ゾーンあたりの最大表示行数（最大200）" value={editor.fullPartsShelfMaxItemsStr} onChange={editor.setFullPartsShelfMaxItemsStr} placeholder="12" />
          )}

          {isFullData && editor.fullSlotKind === 'self_inspection_machine_board' && (
            <div className="sh-legacy">
              <SelfInspectionMachineBoardFields
                targetMode={editor.fullSelfInspectionTargetMode}
                setTargetMode={editor.setFullSelfInspectionTargetMode}
                machineName={editor.fullSelfInspectionMachineName}
                setMachineName={editor.setFullSelfInspectionMachineName}
                deviceScopeKey={editor.fullSelfInspectionDeviceScopeKey}
                setDeviceScopeKey={editor.setFullSelfInspectionDeviceScopeKey}
                slideIntervalStr={editor.fullSelfInspectionSlideIntervalStr}
                setSlideIntervalStr={editor.setFullSelfInspectionSlideIntervalStr}
                partsPerPageStr={editor.fullSelfInspectionPartsPerPageStr}
                setPartsPerPageStr={editor.setFullSelfInspectionPartsPerPageStr}
                legacyAutoMigrationNotice={editor.fullSelfInspectionLegacyAutoMigrationNotice}
                setLegacyAutoMigrationNotice={editor.setFullSelfInspectionLegacyAutoMigrationNotice}
              />
            </div>
          )}
        </div>
      </details>

      {(validationError ?? saveError) && (
        <p className="sh-error" role="alert" style={{ margin: 0 }}>
          {validationError ?? saveError}
        </p>
      )}
    </PanelFrame>
  );
}
