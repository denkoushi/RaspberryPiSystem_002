import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { getApiErrorMessage } from '../../api/errors';
import { useSignageEmergency, useSignageManagementOverview } from '../../api/hooks';
import { DEFAULT_SCHEDULE_FORM_DATA } from '../../features/admin/signage/signageScheduleDisplay';
import { useSignageScheduleEditor } from '../../features/admin/signage/useSignageScheduleEditor';
import { ContentLibrary } from '../../features/admin/signage-hub/ContentLibrary';
import { EmergencyPanel } from '../../features/admin/signage-hub/EmergencyPanel';
import { buildContentLibrary, type LibraryItem } from '../../features/admin/signage-hub/hubModel';
import { HubStage } from '../../features/admin/signage-hub/HubStage';
import { PdfPanel } from '../../features/admin/signage-hub/PdfPanel';
import { SchedulePanel } from '../../features/admin/signage-hub/SchedulePanel';
import { ScreensColumn } from '../../features/admin/signage-hub/ScreensColumn';
import { useSignageClientImage } from '../../features/admin/signage-hub/useSignageClientImage';
import { useWebCaptureEditor } from '../../features/admin/signage-hub/useWebCaptureEditor';
import { WebCapturePanel } from '../../features/admin/signage-hub/WebCapturePanel';
import {
  buildWeekTimelineBlocks,
  formatMinute,
  listOffTimelineSchedules,
  summarizeToday,
} from '../../features/admin/signage-hub/weekTimelineModel';
import { WeekTimelineView } from '../../features/admin/signage-hub/WeekTimelineView';
import { listSignageDisplayClientDevicesSorted } from '../../lib/signageTargetClientDevices';

import '../../features/admin/signage-hub/signageHub.css';

type SidePanel = 'library' | 'web-capture' | 'pdf' | 'emergency';

function panelFromQuery(value: string | null): SidePanel {
  if (value === 'emergency') return 'emergency';
  if (value === 'pdf-upload') return 'pdf';
  return 'library';
}

function formatClockWithSeconds(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ja-JP', { hour12: false });
}

/** 右下の Hermes チャットを開く（既存の丸ボタンを押すのと同じ） */
function openHermesChat() {
  document.querySelector<HTMLButtonElement>('.hermes-floating-trigger')?.click();
}

/**
 * サイネージ管理の 1 画面ハブ。端末・放映中・週間予定・コンテンツを同時に見て、
 * 予定の追加と変更、ページ撮影、PDF、緊急表示までをページ遷移なしで行う。
 */
export function SignageHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const editor = useSignageScheduleEditor();
  const webEditor = useWebCaptureEditor();
  const overviewQuery = useSignageManagementOverview();
  const emergencyQuery = useSignageEmergency();
  const [panel, setPanel] = useState<SidePanel>(() => panelFromQuery(searchParams.get('panel')));
  const [selectedClientKey, setSelectedClientKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [imageRefreshToken, setImageRefreshToken] = useState(0);
  const [renderNotice, setRenderNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const clients = useMemo(
    () => listSignageDisplayClientDevicesSorted(editor.clientsForSignageQuery.data ?? []),
    [editor.clientsForSignageQuery.data],
  );
  useEffect(() => {
    if (clients.length === 0) return;
    if (!selectedClientKey || !clients.some((client) => client.apiKey === selectedClientKey)) {
      setSelectedClientKey(clients[0].apiKey);
    }
  }, [clients, selectedClientKey]);
  const selectedClient = clients.find((client) => client.apiKey === selectedClientKey) ?? null;

  const schedules = useMemo(() => editor.schedulesQuery.data ?? [], [editor.schedulesQuery.data]);
  const timeline = useMemo(
    () => buildWeekTimelineBlocks(schedules, selectedClientKey, now),
    [schedules, selectedClientKey, now],
  );
  const today = useMemo(() => summarizeToday(timeline), [timeline]);
  const offTimeline = useMemo(() => listOffTimelineSchedules(schedules, selectedClientKey), [schedules, selectedClientKey]);
  const libraryItems = useMemo(
    () =>
      buildContentLibrary({
        schedules,
        webCaptures: editor.webCapturesQuery.data ?? [],
        pdfs: editor.pdfsQuery.data ?? [],
        csvDashboards: editor.csvDashboardsQuery.data ?? [],
        visualizationDashboards: editor.visualizationDashboardsQuery.data ?? [],
      }),
    [
      schedules,
      editor.webCapturesQuery.data,
      editor.pdfsQuery.data,
      editor.csvDashboardsQuery.data,
      editor.visualizationDashboardsQuery.data,
    ],
  );

  const { imageUrl, error: imageError } = useSignageClientImage(selectedClientKey, 30_000, imageRefreshToken);
  const overviewEntry = overviewQuery.data?.clients.find((entry) => entry.apiKey === selectedClientKey);
  const emergencyActive = emergencyQuery.data?.enabled ?? false;
  const isEditingSchedule = editor.isCreating || editor.editingId !== null;

  const showPanel = (next: SidePanel) => {
    setPanel(next);
    if (searchParams.has('panel')) {
      const params = new URLSearchParams(searchParams);
      params.delete('panel');
      setSearchParams(params, { replace: true });
    }
  };

  const handlePlace = (item: LibraryItem) => {
    const source = item.source;
    if (source.type === 'chat') return;
    editor.handleCreate();
    editor.setUseNewLayout(true);
    editor.setLayoutType('FULL');
    editor.setFormData({ ...DEFAULT_SCHEDULE_FORM_DATA, name: item.name });
    if (source.type === 'web_page') {
      editor.setFullSlotKind('web_page');
      editor.setFullWebCaptureId(source.webCaptureId);
    } else if (source.type === 'pdf') {
      editor.setFullSlotKind('pdf');
      editor.setFullPdfId(source.pdfId);
    } else if (source.type === 'csv_dashboard') {
      editor.setFullSlotKind('csv_dashboard');
      editor.setFullCsvDashboardId(source.csvDashboardId);
    } else if (source.type === 'visualization') {
      editor.setFullSlotKind('visualization');
      editor.setFullVisualizationDashboardId(source.visualizationDashboardId);
    } else {
      editor.setFullSlotKind(source.kind);
    }
  };

  const handleEditItem = (item: LibraryItem) => {
    const source = item.source;
    if (source.type === 'web_page') {
      const capture = editor.webCapturesQuery.data?.find((entry) => entry.id === source.webCaptureId) ?? null;
      webEditor.start(capture);
      showPanel('web-capture');
    } else if (source.type === 'pdf') {
      showPanel('pdf');
    } else if (source.type === 'chat') {
      const schedule = schedules.find((entry) => entry.id === source.scheduleId);
      if (schedule) editor.handleEdit(schedule);
    }
  };

  const handleSelectSchedule = (scheduleId: string) => {
    const schedule = schedules.find((entry) => entry.id === scheduleId);
    if (schedule) editor.handleEdit(schedule);
  };

  const handleRender = async () => {
    setRenderNotice(null);
    try {
      await editor.renderMutation.mutateAsync();
      setImageRefreshToken((value) => value + 1);
      void overviewQuery.refetch();
      setRenderNotice('再描画しました');
    } catch (err) {
      setRenderNotice(getApiErrorMessage(err, '再描画に失敗しました'));
    }
  };

  const captureStage =
    !isEditingSchedule && panel === 'web-capture' && webEditor.preview
      ? {
          preview: webEditor.preview,
          viewportWidth: webEditor.draft.viewportWidth,
          viewportHeight: webEditor.draft.viewportHeight,
        }
      : null;

  return (
    <div className="signage-hub">
      {emergencyActive && (
        <div className="sh-emergency-band" role="status">
          <span>緊急表示中</span>
          <span>全端末</span>
          {emergencyQuery.data?.expiresAt && (
            <span className="sh-mono">
              {formatClockWithSeconds(emergencyQuery.data.expiresAt).slice(0, 5)} に自動解除
            </span>
          )}
        </div>
      )}

      <div className="sh-head">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, flexWrap: 'wrap' }}>
          <h1>サイネージ</h1>
          <div className="sh-head-meta sh-mono">
            {clients.length} 端末 · 本日 {today.todayBlockCount} 枠 · 最終描画 {formatClockWithSeconds(overviewEntry?.renderedAt)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {renderNotice && (
            <span className="sh-hint" role="status">
              {renderNotice}
            </span>
          )}
          <button
            type="button"
            className={emergencyActive ? 'sh-btn sh-btn-danger' : 'sh-btn sh-btn-danger-outline'}
            onClick={() => showPanel('emergency')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
            </svg>
            {emergencyActive ? '緊急表示中' : '緊急表示'}
          </button>
          <button type="button" className="sh-btn" onClick={() => void handleRender()} disabled={editor.renderMutation.isPending}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            {editor.renderMutation.isPending ? '再描画中…' : '今すぐ再描画'}
          </button>
        </div>
      </div>

      <div className="sh-body">
        <ScreensColumn
          clients={clients}
          overview={overviewQuery.data}
          now={now}
          selectedClientKey={selectedClientKey}
          onSelect={setSelectedClientKey}
          isLoading={editor.clientsForSignageQuery.isLoading}
        />

        <section aria-label="放映中と予定" className="sh-col" style={{ gap: 16 }}>
          <div className="sh-row-between" style={{ minHeight: 28, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              {isEditingSchedule ? (
                <>
                  <span className="sh-chip sh-chip-edit">編集中</span>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{editor.formData.name || '新しい予定'}</span>
                </>
              ) : panel === 'web-capture' ? (
                <>
                  <span className="sh-chip sh-chip-capture">撮影プレビュー</span>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{webEditor.draft.name || webEditor.draft.path}</span>
                </>
              ) : emergencyActive ? (
                <>
                  <span className="sh-chip sh-chip-emergency">緊急</span>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>全端末に割り込み中</span>
                </>
              ) : (
                <>
                  <span className="sh-chip sh-chip-onair">ON AIR</span>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>
                    {selectedClient ? selectedClient.name : '端末を選んでください'}
                    {today.onAirNames.length > 0
                      ? ` ／ ${today.onAirNames.join('・')}`
                      : schedules.some((schedule) => schedule.enabled)
                        ? ' ／ 予定の時間外（優先順位の高い予定を表示）'
                        : ''}
                  </span>
                </>
              )}
            </div>
            <div className="sh-mono" style={{ fontSize: 12, color: 'var(--sh-muted)' }}>
              {captureStage
                ? `撮影 ${(captureStage.preview.durationMs / 1000).toFixed(1)}s`
                : today.next
                  ? `次 ${formatMinute(today.next.startMinute)} ${today.next.name}`
                  : '本日はこのあと予定なし'}
            </div>
          </div>

          <HubStage
            imageUrl={panel === 'web-capture' && !isEditingSchedule ? null : imageUrl}
            alt={selectedClient ? `${selectedClient.name} に配信中の画像` : '配信中の画像'}
            emptyText={
              panel === 'web-capture' && !isEditingSchedule
                ? webEditor.isPreviewing
                  ? '撮影中…'
                  : '「試し撮り」を押すと、ここにページが表示されます。'
                : (imageError ?? (selectedClient ? '画像を読み込み中…' : '端末がありません'))
            }
            capture={captureStage}
            onToggleRegion={webEditor.toggleHideSelector}
            note={
              panel === 'web-capture' && !isEditingSchedule && !captureStage
                ? null
                : captureStage
                  ? `${captureStage.viewportWidth}×${captureStage.viewportHeight}`
                  : null
            }
          />

          <WeekTimelineView
            timeline={timeline}
            clientName={selectedClient?.name ?? null}
            selectedScheduleId={editor.editingId}
            onSelectSchedule={handleSelectSchedule}
            offTimeline={offTimeline}
          />
        </section>

        <div className="sh-right" style={{ minWidth: 0 }}>
          {isEditingSchedule ? (
            <SchedulePanel editor={editor} />
          ) : panel === 'web-capture' ? (
            <WebCapturePanel
              editor={webEditor}
              onBack={() => showPanel('library')}
              onSaved={(webCaptureId, name, place) => {
                showPanel('library');
                if (place) {
                  handlePlace({
                    key: `web_page:${webCaptureId}`,
                    kind: 'web_page',
                    name,
                    meta: '',
                    usedCount: 0,
                    warning: null,
                    source: { type: 'web_page', webCaptureId },
                  });
                }
              }}
            />
          ) : panel === 'pdf' ? (
            <PdfPanel onBack={() => showPanel('library')} />
          ) : panel === 'emergency' ? (
            <EmergencyPanel onBack={() => showPanel('library')} />
          ) : (
            <ContentLibrary
              items={libraryItems}
              onAddWebCapture={() => {
                webEditor.start(null);
                showPanel('web-capture');
              }}
              onAddPdf={() => showPanel('pdf')}
              onOpenChat={openHermesChat}
              onPlace={handlePlace}
              onEditItem={handleEditItem}
            />
          )}
        </div>
      </div>
    </div>
  );
}
