import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { getApiErrorMessage } from '../../api/errors';
import { useSignageEmergency, useSignageManagementOverview } from '../../api/hooks';
import { Dialog } from '../../components/ui/Dialog';
import { DEFAULT_SCHEDULE_FORM_DATA } from '../../features/admin/signage/signageScheduleDisplay';
import { useSignageScheduleEditor } from '../../features/admin/signage/useSignageScheduleEditor';
import { ContentLibrary } from '../../features/admin/signage-hub/ContentLibrary';
import { EmergencyPanel } from '../../features/admin/signage-hub/EmergencyPanel';
import { buildContentLibrary, formatAgo, judgeDelivery, type LibraryItem } from '../../features/admin/signage-hub/hubModel';
import { HubStage } from '../../features/admin/signage-hub/HubStage';
import { PdfPanel } from '../../features/admin/signage-hub/PdfPanel';
import { buildPlaylist, nextInRotation } from '../../features/admin/signage-hub/playlistModel';
import { PlaylistPanel } from '../../features/admin/signage-hub/PlaylistPanel';
import { QuickAddDialog } from '../../features/admin/signage-hub/QuickAddDialog';
import { SchedulePanel } from '../../features/admin/signage-hub/SchedulePanel';
import { useSignageClientImage } from '../../features/admin/signage-hub/useSignageClientImage';
import { useWebCaptureEditor } from '../../features/admin/signage-hub/useWebCaptureEditor';
import { WebCapturePanel } from '../../features/admin/signage-hub/WebCapturePanel';
import { buildWeekTimelineBlocks, listOffTimelineSchedules } from '../../features/admin/signage-hub/weekTimelineModel';
import { WeekTimelineView } from '../../features/admin/signage-hub/WeekTimelineView';
import { listSignageDisplayClientDevicesSorted } from '../../lib/signageTargetClientDevices';

import '../../features/admin/signage-hub/theme';

/** ふだんは閉じている、2 番手の機能 */
type Sheet = 'none' | 'quick' | 'week' | 'emergency' | 'library' | 'web-capture' | 'pdf';

function sheetFromQuery(value: string | null): Sheet {
  if (value === 'emergency') return 'emergency';
  if (value === 'pdf-upload') return 'pdf';
  return 'none';
}

function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const DELIVERY_TEXT = { ok: '端末は受信中', stale: '端末が応答なし', never: '端末の受信記録なし' } as const;

/**
 * サイネージ: 「映すものを選ぶ → 画面 → 映す」を前面に置いた 1 画面。
 * ふだん見えるのは、いま映っているものと、その画面で順番に映すものだけ。
 * 週間の見え方・素材の整理・緊急表示・細かい設定は、必要なときだけ開く。
 */
export function SignageHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const editor = useSignageScheduleEditor();
  const webEditor = useWebCaptureEditor();
  const overviewQuery = useSignageManagementOverview();
  const emergencyQuery = useSignageEmergency();
  const [sheet, setSheet] = useState<Sheet>(() => sheetFromQuery(searchParams.get('panel')));
  const [selectedClientKey, setSelectedClientKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [imageRefreshToken, setImageRefreshToken] = useState(0);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
  const overview = overviewQuery.data;
  const overviewEntry = overview?.clients.find((entry) => entry.apiKey === selectedClientKey);
  const interval = overview?.renderIntervalSeconds ?? 30;
  const switchSeconds = overview?.scheduleSwitchIntervalSeconds ?? 30;
  const playlist = useMemo(
    () => buildPlaylist(schedules, selectedClientKey, overviewEntry?.rotation),
    [schedules, selectedClientKey, overviewEntry?.rotation],
  );
  const onAir = playlist.find((item) => item.isOnAir) ?? null;
  const next = nextInRotation(overviewEntry?.rotation);
  const nextName = next ? (schedules.find((schedule) => schedule.id === next.scheduleId)?.name ?? null) : null;

  const { imageUrl, error: imageError } = useSignageClientImage(selectedClientKey, 30_000, imageRefreshToken);
  const emergencyActive = emergencyQuery.data?.enabled ?? false;
  const isAdvancedEditing = editor.isCreating || editor.editingId !== null;
  const deliveryOf = (apiKey: string) =>
    judgeDelivery(overview?.clients.find((entry) => entry.apiKey === apiKey)?.lastFetchedAt ?? null, now, interval);
  const delivery = selectedClientKey ? deliveryOf(selectedClientKey) : null;

  const timeline = useMemo(() => buildWeekTimelineBlocks(schedules, selectedClientKey, now), [schedules, selectedClientKey, now]);
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
    [schedules, editor.webCapturesQuery.data, editor.pdfsQuery.data, editor.csvDashboardsQuery.data, editor.visualizationDashboardsQuery.data],
  );

  const openSheet = (nextSheet: Sheet) => {
    setSheet(nextSheet);
    if (searchParams.has('panel')) {
      const params = new URLSearchParams(searchParams);
      params.delete('panel');
      setSearchParams(params, { replace: true });
    }
  };

  /** 細かい設定つきの新規作成（左右分割や、追加の設定が要る種類） */
  const startAdvancedCreate = (item?: LibraryItem) => {
    setSheet('none');
    editor.handleCreate();
    editor.setUseNewLayout(true);
    editor.setLayoutType('FULL');
    if (!item || item.source.type === 'chat') return;
    const source = item.source;
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
      webEditor.start(editor.webCapturesQuery.data?.find((entry) => entry.id === source.webCaptureId) ?? null);
      setSheet('web-capture');
    } else if (source.type === 'pdf') {
      setSheet('pdf');
    } else if (source.type === 'chat') {
      const schedule = schedules.find((entry) => entry.id === source.scheduleId);
      if (schedule) {
        setSheet('none');
        editor.handleEdit(schedule);
      }
    }
  };

  const handleRender = async () => {
    setNotice(null);
    try {
      await editor.renderMutation.mutateAsync();
      setImageRefreshToken((value) => value + 1);
      void overviewQuery.refetch();
      setNotice('映し直しました');
    } catch (err) {
      setNotice(getApiErrorMessage(err, '映し直せませんでした'));
    }
  };

  const captureStage =
    sheet === 'web-capture' && webEditor.preview
      ? { preview: webEditor.preview, viewportWidth: webEditor.draft.viewportWidth, viewportHeight: webEditor.draft.viewportHeight }
      : null;

  return (
    <div className="signage-hub sh-quick-hub">
      {emergencyActive && (
        <div className="sh-emergency-band" role="status">
          <span>緊急表示中</span>
          <span>全端末</span>
          {emergencyQuery.data?.expiresAt && <span className="sh-mono">{formatClock(emergencyQuery.data.expiresAt)} に自動解除</span>}
        </div>
      )}

      <div className="sh-head" style={{ minHeight: 76 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <h1>サイネージ</h1>
          <div role="tablist" aria-label="画面" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {clients.map((client) => (
              <button
                key={client.id}
                type="button"
                role="tab"
                className="sh-screen-tab"
                aria-selected={client.apiKey === selectedClientKey}
                data-state={deliveryOf(client.apiKey).state}
                onClick={() => setSelectedClientKey(client.apiKey)}
              >
                <i aria-hidden="true" />
                {client.name}
              </button>
            ))}
            {!editor.clientsForSignageQuery.isLoading && clients.length === 0 && (
              <span className="sh-hint">サイネージ用の端末がありません。クライアント管理で登録してください。</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className={emergencyActive ? 'sh-btn sh-btn-danger' : 'sh-btn sh-btn-danger-outline'} onClick={() => openSheet('emergency')}>
            {emergencyActive ? '緊急表示中' : '緊急表示'}
          </button>
          <button type="button" className="sh-go" onClick={() => openSheet('quick')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            映す
          </button>
        </div>
      </div>

      <div className="sh-quick-grid">
        <section aria-label="いま映っているもの" className="sh-col" style={{ gap: 14 }}>
          <div className="sh-row-between" style={{ minHeight: 28, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <span className={emergencyActive ? 'sh-chip sh-chip-emergency' : 'sh-chip sh-chip-onair'}>{emergencyActive ? '緊急' : 'ON AIR'}</span>
              <span style={{ fontSize: 15, fontWeight: 600 }}>
                {selectedClient ? selectedClient.name : '画面を選んでください'}
                {emergencyActive ? ' ／ 緊急表示' : onAir ? ` ／ ${onAir.name}` : ''}
              </span>
            </div>
            <span className="sh-mono" style={{ fontSize: 12, color: 'var(--sh-muted)' }}>
              {emergencyActive
                ? '解除すると、順番の表示に戻ります'
                : next && nextName
                  ? `次は ${nextName} · あと ${next.secondsUntilSwitch}秒`
                  : overviewEntry?.rotation.isFallback
                    ? 'いまの時間に映すものがないため、代わりを表示中'
                    : ''}
            </span>
          </div>

          <HubStage
            imageUrl={imageUrl}
            alt={selectedClient ? `${selectedClient.name} に映っている画面` : '映っている画面'}
            emptyText={imageError ?? (selectedClient ? '画面を読み込み中…' : '端末がありません')}
          />

          <div className="sh-quiet-row">
            {delivery && (
              <span className="sh-quiet" data-state={delivery.state} title={`サーバの描画: ${formatClock(overviewEntry?.renderedAt)}`}>
                <i aria-hidden="true" />
                {DELIVERY_TEXT[delivery.state]}
                {delivery.secondsAgo !== null ? ` · ${formatAgo(delivery.secondsAgo)}` : ''}
              </span>
            )}
            <button type="button" className="sh-quiet" onClick={() => openSheet('week')}>
              週間の見え方
            </button>
            <button type="button" className="sh-quiet" onClick={() => openSheet('library')}>
              素材を整理
            </button>
            <Link to="/admin/data-boards" className="sh-quiet">
              データボード
            </Link>
            <button type="button" className="sh-quiet" onClick={() => void handleRender()} disabled={editor.renderMutation.isPending}>
              {editor.renderMutation.isPending ? '映し直し中…' : '今すぐ映し直す'}
            </button>
            {notice && (
              <span className="sh-hint" role="status">
                {notice}
              </span>
            )}
          </div>
        </section>

        <PlaylistPanel
          items={playlist}
          schedules={schedules}
          clientKey={selectedClientKey}
          clientName={selectedClient?.name ?? null}
          switchSeconds={switchSeconds}
          justAddedId={justAddedId}
          onAdd={() => openSheet('quick')}
          onAdvanced={(schedule) => editor.handleEdit(schedule)}
        />
      </div>

      <QuickAddDialog
        isOpen={sheet === 'quick'}
        onClose={() => setSheet('none')}
        onDone={(scheduleId) => {
          setSheet('none');
          setJustAddedId(scheduleId);
          void overviewQuery.refetch();
        }}
        onAdvanced={() => startAdvancedCreate()}
        clients={clients}
        defaultClientKey={selectedClientKey}
        visualizationDashboards={editor.visualizationDashboardsQuery.data ?? []}
        csvDashboards={editor.csvDashboardsQuery.data ?? []}
      />

      <Dialog isOpen={isAdvancedEditing} onClose={editor.handleCancel} ariaLabel="予定の詳しい設定" size="md" className="signage-hub sh-dialog sh-dialog-panel">
        {isAdvancedEditing && <SchedulePanel editor={editor} />}
      </Dialog>

      <Dialog isOpen={sheet === 'emergency'} onClose={() => setSheet('none')} ariaLabel="緊急表示" size="md" className="signage-hub sh-dialog sh-dialog-panel">
        {sheet === 'emergency' && <EmergencyPanel onBack={() => setSheet('none')} />}
      </Dialog>

      <Dialog isOpen={sheet === 'week'} onClose={() => setSheet('none')} title="週間の見え方" size="full" className="signage-hub sh-dialog">
        <WeekTimelineView
          timeline={timeline}
          clientName={selectedClient?.name ?? null}
          selectedScheduleId={null}
          onSelectSchedule={(scheduleId) => {
            const schedule = schedules.find((entry) => entry.id === scheduleId);
            if (schedule) {
              setSheet('none');
              editor.handleEdit(schedule);
            }
          }}
          offTimeline={offTimeline}
        />
        <p className="sh-hint" style={{ margin: '12px 0 0' }}>
          枠を押すと、その予定の詳しい設定を開きます。同じ時間に重なるものは、{switchSeconds}秒ずつ順番に映ります。
        </p>
      </Dialog>

      <Dialog isOpen={sheet === 'library'} onClose={() => setSheet('none')} ariaLabel="素材を整理" size="md" className="signage-hub sh-dialog sh-dialog-panel">
        {sheet === 'library' && (
          <ContentLibrary
            items={libraryItems}
            onAddWebCapture={() => {
              webEditor.start(null);
              setSheet('web-capture');
            }}
            onAddPdf={() => setSheet('pdf')}
            onOpenChat={() => {
              setSheet('none');
              document.querySelector<HTMLButtonElement>('.hermes-floating-trigger')?.click();
            }}
            onPlace={(item) => startAdvancedCreate(item)}
            onEditItem={handleEditItem}
          />
        )}
      </Dialog>

      <Dialog isOpen={sheet === 'web-capture'} onClose={() => setSheet('library')} ariaLabel="ページ撮影の設定" size="full" className="signage-hub sh-dialog">
        {sheet === 'web-capture' && (
          <div className="sh-capture-sheet">
            <HubStage
              imageUrl={null}
              alt="撮影したページ"
              emptyText={webEditor.isPreviewing ? '撮影中…' : '「試し撮り」を押すと、ここにページが表示されます。'}
              capture={captureStage}
              onToggleRegion={webEditor.toggleHideSelector}
            />
            <WebCapturePanel
              editor={webEditor}
              onBack={() => setSheet('library')}
              onSaved={(webCaptureId, name, place) => {
                if (place) {
                  startAdvancedCreate({ key: `web_page:${webCaptureId}`, kind: 'web_page', name, meta: '', usedCount: 0, warning: null, source: { type: 'web_page', webCaptureId } });
                } else {
                  setSheet('library');
                }
              }}
            />
          </div>
        )}
      </Dialog>

      <Dialog isOpen={sheet === 'pdf'} onClose={() => setSheet('library')} ariaLabel="ファイルの管理" size="md" className="signage-hub sh-dialog sh-dialog-panel">
        {sheet === 'pdf' && <PdfPanel onBack={() => setSheet('library')} />}
      </Dialog>
    </div>
  );
}
