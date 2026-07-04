import { SignageTargetClientsField } from '../../../components/signage/SignageTargetClientsField';
import { Button } from '../../../components/ui/Button';

import { DAYS_OF_WEEK, parseResourceCdListInput } from './signageScheduleDisplay';
import {
  VisualizationDashboardGroupedSelect,
  VisualizationDashboardSelectHelp,
} from './VisualizationDashboardGroupedSelect';

import type { SignageScheduleEditorController } from './useSignageScheduleEditor';
import type { CsvDashboard, SignagePdf } from '../../../api/client';

type SignageScheduleEditorFormProps = {
  editor: SignageScheduleEditorController;
};

export function SignageScheduleEditorForm({ editor }: SignageScheduleEditorFormProps) {
  const {
    isCreating,
    editingId,
    formData,
    setFormData,
    useNewLayout,
    setUseNewLayout,
    layoutType,
    setLayoutType,
    fullSlotKind,
    setFullSlotKind,
    resetFullSlotSpecificFields,
    fullPdfId,
    setFullPdfId,
    fullCsvDashboardId,
    setFullCsvDashboardId,
    fullVisualizationDashboardId,
    setFullVisualizationDashboardId,
    fullKioskDeviceScopeKey,
    setFullKioskDeviceScopeKey,
    fullKioskSlideIntervalStr,
    setFullKioskSlideIntervalStr,
    fullKioskSeibanPerPageStr,
    setFullKioskSeibanPerPageStr,
    fullLeaderOrderDeviceScopeKey,
    setFullLeaderOrderDeviceScopeKey,
    fullLeaderOrderResourceCdsText,
    setFullLeaderOrderResourceCdsText,
    fullLeaderOrderSlideIntervalStr,
    setFullLeaderOrderSlideIntervalStr,
    fullLeaderOrderCardsPerPageStr,
    setFullLeaderOrderCardsPerPageStr,
    fullPartsShelfMaxItemsStr,
    setFullPartsShelfMaxItemsStr,
    fullSelfInspectionTargetMode,
    setFullSelfInspectionTargetMode,
    fullSelfInspectionMachineName,
    setFullSelfInspectionMachineName,
    fullSelfInspectionDeviceScopeKey,
    setFullSelfInspectionDeviceScopeKey,
    fullSelfInspectionResourceCdsText,
    setFullSelfInspectionResourceCdsText,
    fullSelfInspectionMaxAutoMachinesStr,
    setFullSelfInspectionMaxAutoMachinesStr,
    fullSelfInspectionSlideIntervalStr,
    setFullSelfInspectionSlideIntervalStr,
    fullSelfInspectionPartsPerPageStr,
    setFullSelfInspectionPartsPerPageStr,
    fullSelfInspectionDetailTopNStr,
    setFullSelfInspectionDetailTopNStr,
    leftSlotKind,
    setLeftSlotKind,
    leftPdfId,
    setLeftPdfId,
    leftCsvDashboardId,
    setLeftCsvDashboardId,
    leftVisualizationDashboardId,
    setLeftVisualizationDashboardId,
    rightSlotKind,
    setRightSlotKind,
    rightPdfId,
    setRightPdfId,
    rightCsvDashboardId,
    setRightCsvDashboardId,
    rightVisualizationDashboardId,
    setRightVisualizationDashboardId,
    pdfsQuery,
    csvDashboardsQuery,
    visualizationDashboardsQuery,
    clientsForSignageQuery,
    create,
    update,
    toggleDayOfWeek,
    handleSave,
    handleCancel,
  } = editor;

  if (!isCreating && !editingId) {
    return null;
  }

  return (
    <div className="mb-6 space-y-4 rounded-lg border-2 border-slate-500 bg-slate-100 p-4 shadow-lg">
      <div>
        <label className="block text-sm font-semibold text-slate-700">スケジュール名</label>
        <input
          type="text"
          value={formData.name || ''}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={useNewLayout}
          onChange={(e) => setUseNewLayout(e.target.checked)}
          className="rounded border-2 border-slate-500"
        />
        <label className="text-sm font-semibold text-slate-700">新形式レイアウトを使用（全体/左右を自由に設定）</label>
      </div>

      {useNewLayout ? (
        <>
          <div>
            <label className="block text-sm font-semibold text-slate-700">レイアウト</label>
            <select
              value={layoutType}
              onChange={(e) => setLayoutType(e.target.value as 'FULL' | 'SPLIT')}
              className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
            >
              <option value="FULL">全体表示</option>
              <option value="SPLIT">左右分割</option>
            </select>
          </div>

          {layoutType === 'FULL' ? (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700">表示コンテンツ</label>
                <select
                  value={fullSlotKind}
                  onChange={(e) => {
                    resetFullSlotSpecificFields();
                    setFullSlotKind(
                      e.target.value as
                        | 'loans'
                        | 'pdf'
                        | 'csv_dashboard'
                        | 'visualization'
                        | 'kiosk_progress_overview'
                        | 'kiosk_leader_order_cards'
                        | 'mobile_placement_parts_shelf_grid'
                        | 'self_inspection_machine_board'
                    );
                  }}
                  className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                >
                  <option value="loans">持出一覧</option>
                  <option value="pdf">PDF</option>
                  <option value="csv_dashboard">CSVダッシュボード</option>
                  <option value="visualization">可視化</option>
                  <option value="kiosk_progress_overview">キオスク進捗一覧（JPEG）</option>
                  <option value="kiosk_leader_order_cards">キオスク順位ボード・資源CDカード（JPEG）</option>
                  <option value="mobile_placement_parts_shelf_grid">配膳 Android 部品棚 9枠（JPEG）</option>
                  <option value="self_inspection_machine_board">自主検査 機種別進捗ボード（JPEG）</option>
                </select>
              </div>
              {fullSlotKind === 'pdf' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700">PDF</label>
                  <select
                    value={fullPdfId || ''}
                    onChange={(e) => setFullPdfId(e.target.value || null)}
                    className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  >
                    <option value="">選択してください</option>
                    {pdfsQuery.data?.map((pdf: SignagePdf) => (
                      <option key={pdf.id} value={pdf.id}>
                        {pdf.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {fullSlotKind === 'csv_dashboard' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700">CSVダッシュボード</label>
                  <select
                    value={fullCsvDashboardId || ''}
                    onChange={(e) => setFullCsvDashboardId(e.target.value || null)}
                    className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  >
                    <option value="">選択してください</option>
                    {csvDashboardsQuery.data?.map((dashboard: CsvDashboard) => (
                      <option key={dashboard.id} value={dashboard.id}>
                        {dashboard.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {fullSlotKind === 'visualization' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="signage-full-visualization">
                    可視化
                  </label>
                  <VisualizationDashboardGroupedSelect
                    id="signage-full-visualization"
                    value={fullVisualizationDashboardId}
                    onChange={setFullVisualizationDashboardId}
                    dashboards={visualizationDashboardsQuery.data}
                    isListPending={visualizationDashboardsQuery.isPending}
                    isListError={visualizationDashboardsQuery.isError}
                  />
                  <VisualizationDashboardSelectHelp />
                </div>
              )}
              {fullSlotKind === 'kiosk_progress_overview' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">
                      deviceScopeKey（キオスク端末と同じスコープ文字列・必須）
                    </label>
                    <input
                      type="text"
                      value={fullKioskDeviceScopeKey}
                      onChange={(e) => setFullKioskDeviceScopeKey(e.target.value)}
                      placeholder="例: 端末設定のスコープキー"
                      className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    />
                    <p className="mt-1 text-xs text-slate-600">
                      空にすると保存時は持出一覧にフォールバックします。未入力では保存できません（必須）。
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">
                      ページ表示秒（任意・既定30）
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fullKioskSlideIntervalStr}
                      onChange={(e) => setFullKioskSlideIntervalStr(e.target.value)}
                      placeholder="30"
                      className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">
                      1ページの製番数（任意・既定8・最大8・サイネージは4列×2段）
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fullKioskSeibanPerPageStr}
                      onChange={(e) => setFullKioskSeibanPerPageStr(e.target.value)}
                      placeholder="8"
                      className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    />
                  </div>
                </div>
              )}
              {fullSlotKind === 'kiosk_leader_order_cards' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">
                      deviceScopeKey（キオスク端末と同じスコープ文字列・必須）
                    </label>
                    <input
                      type="text"
                      value={fullLeaderOrderDeviceScopeKey}
                      onChange={(e) => setFullLeaderOrderDeviceScopeKey(e.target.value)}
                      placeholder="例: 端末設定のスコープキー"
                      className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">
                      資源CD（1行1件、またはカンマ区切り・最大32件・順序どおり表示）
                    </label>
                    <textarea
                      value={fullLeaderOrderResourceCdsText}
                      onChange={(e) => setFullLeaderOrderResourceCdsText(e.target.value)}
                      rows={5}
                      placeholder={'例:\nR001\nR002'}
                      className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 font-mono text-sm font-semibold text-slate-900"
                    />
                    <p className="mt-1 text-xs text-slate-600">
                      現在の入力: {parseResourceCdListInput(fullLeaderOrderResourceCdsText).length} 件
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">
                      ページ切替え秒（任意・既定30・複数資源で1画面に収まらないとき）
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fullLeaderOrderSlideIntervalStr}
                      onChange={(e) => setFullLeaderOrderSlideIntervalStr(e.target.value)}
                      placeholder="30"
                      className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">
                      1ページの資源カード数（任意・既定10・最大10・5列×2段）
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fullLeaderOrderCardsPerPageStr}
                      onChange={(e) => setFullLeaderOrderCardsPerPageStr(e.target.value)}
                      placeholder="10"
                      className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    />
                  </div>
                </div>
              )}
              {fullSlotKind === 'mobile_placement_parts_shelf_grid' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600">
                    配膳の現在棚（OrderPlacementBranchState）を 9 ゾーンに集約して表示します。棚コードは「西-北-02」形式のみ対象です。超過分は省略表示されます。
                  </p>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">
                      ゾーンあたりの最大表示行数（任意・空欄で既定12・最大200）
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fullPartsShelfMaxItemsStr}
                      onChange={(e) => setFullPartsShelfMaxItemsStr(e.target.value)}
                      placeholder="12"
                      className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    />
                  </div>
                </div>
              )}
              {fullSlotKind === 'self_inspection_machine_board' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">
                      対象選定モード targetMode
                    </label>
                    <select
                      value={fullSelfInspectionTargetMode}
                      onChange={(e) =>
                        setFullSelfInspectionTargetMode(
                          e.target.value as
                            | 'manual_machine_name'
                            | 'auto_from_leaderboard_status'
                        )
                      }
                      className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    >
                      <option value="manual_machine_name">機種名を手入力</option>
                      <option value="auto_from_leaderboard_status">
                        順位ボードの入力中機種を自動選定
                      </option>
                    </select>
                  </div>
                  {fullSelfInspectionTargetMode === 'manual_machine_name' ? (
                    <div>
                      <label className="block text-sm font-semibold text-slate-700">
                        機種名 machineName（必須・生産日程と正規化比較）
                      </label>
                      <input
                        type="text"
                        value={fullSelfInspectionMachineName}
                        onChange={(e) => setFullSelfInspectionMachineName(e.target.value)}
                        placeholder="例: L300KP"
                        className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                      />
                      <p className="mt-1 text-xs text-slate-600">
                        未入力では保存できません（必須）。
                      </p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700">
                          resourceCds（必須・順位ボードと同じ資源CD）
                        </label>
                        <textarea
                          value={fullSelfInspectionResourceCdsText}
                          onChange={(e) => setFullSelfInspectionResourceCdsText(e.target.value)}
                          placeholder={'例:\nRD01\nRD02'}
                          rows={4}
                          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 font-mono text-sm font-semibold text-slate-900"
                        />
                        <p className="mt-1 text-xs text-slate-600">
                          現在の入力: {parseResourceCdListInput(fullSelfInspectionResourceCdsText).length}{' '}
                          件。黄（入力中）を持つ機種だけを自動表示します。
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700">
                          自動選定機種数上限 maxAutoMachines（任意・既定5・最大20）
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={fullSelfInspectionMaxAutoMachinesStr}
                          onChange={(e) => setFullSelfInspectionMaxAutoMachinesStr(e.target.value)}
                          placeholder="5"
                          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">
                      deviceScopeKey（キオスク端末と同じスコープ文字列・
                      {fullSelfInspectionTargetMode === 'auto_from_leaderboard_status'
                        ? '必須'
                        : '推奨'}
                      ）
                    </label>
                    <input
                      type="text"
                      value={fullSelfInspectionDeviceScopeKey}
                      onChange={(e) => setFullSelfInspectionDeviceScopeKey(e.target.value)}
                      placeholder="例: 端末設定のスコープキー"
                      className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    />
                    <p className="mt-1 text-xs text-slate-600">
                      {fullSelfInspectionTargetMode === 'auto_from_leaderboard_status'
                        ? '自動選定の母集団（拠点・資源 policy）解決に必須です。'
                        : '拠点別の自主検査テンプレート/資源 policy 解決に使用します。未設定時はグローバル fallback です。'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">
                      ページ表示秒（任意・既定30）
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fullSelfInspectionSlideIntervalStr}
                      onChange={(e) => setFullSelfInspectionSlideIntervalStr(e.target.value)}
                      placeholder="30"
                      className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">
                      1ページの部品数（任意・既定12・最大12・1920x1080 1画面分）
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fullSelfInspectionPartsPerPageStr}
                      onChange={(e) => setFullSelfInspectionPartsPerPageStr(e.target.value)}
                      placeholder="12"
                      className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">
                      詳細ヒートストリップ部品数（任意・既定5・最大20）
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fullSelfInspectionDetailTopNStr}
                      onChange={(e) => setFullSelfInspectionDetailTopNStr(e.target.value)}
                      placeholder="5"
                      className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700">左側の表示コンテンツ</label>
                <select
                  value={leftSlotKind}
                  onChange={(e) => {
                    setLeftSlotKind(e.target.value as 'loans' | 'pdf' | 'csv_dashboard' | 'visualization');
                    if (e.target.value === 'loans') {
                      setLeftPdfId(null);
                      setLeftCsvDashboardId(null);
                      setLeftVisualizationDashboardId(null);
                    } else if (e.target.value === 'pdf') {
                      setLeftCsvDashboardId(null);
                      setLeftVisualizationDashboardId(null);
                    } else if (e.target.value === 'csv_dashboard') {
                      setLeftPdfId(null);
                      setLeftVisualizationDashboardId(null);
                    } else if (e.target.value === 'visualization') {
                      setLeftPdfId(null);
                      setLeftCsvDashboardId(null);
                    }
                  }}
                  className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                >
                  <option value="loans">持出一覧</option>
                  <option value="pdf">PDF</option>
                  <option value="csv_dashboard">CSVダッシュボード</option>
                  <option value="visualization">可視化</option>
                </select>
              </div>
              {leftSlotKind === 'pdf' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700">左側のPDF</label>
                  <select
                    value={leftPdfId || ''}
                    onChange={(e) => setLeftPdfId(e.target.value || null)}
                    className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  >
                    <option value="">選択してください</option>
                    {pdfsQuery.data?.map((pdf: SignagePdf) => (
                      <option key={pdf.id} value={pdf.id}>
                        {pdf.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {leftSlotKind === 'csv_dashboard' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700">左側のCSVダッシュボード</label>
                  <select
                    value={leftCsvDashboardId || ''}
                    onChange={(e) => setLeftCsvDashboardId(e.target.value || null)}
                    className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  >
                    <option value="">選択してください</option>
                    {csvDashboardsQuery.data?.map((dashboard: CsvDashboard) => (
                      <option key={dashboard.id} value={dashboard.id}>
                        {dashboard.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {leftSlotKind === 'visualization' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="signage-left-visualization">
                    左側の可視化
                  </label>
                  <VisualizationDashboardGroupedSelect
                    id="signage-left-visualization"
                    value={leftVisualizationDashboardId}
                    onChange={setLeftVisualizationDashboardId}
                    dashboards={visualizationDashboardsQuery.data}
                    isListPending={visualizationDashboardsQuery.isPending}
                    isListError={visualizationDashboardsQuery.isError}
                  />
                  <VisualizationDashboardSelectHelp />
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-slate-700">右側の表示コンテンツ</label>
                <select
                  value={rightSlotKind}
                  onChange={(e) => {
                    setRightSlotKind(e.target.value as 'loans' | 'pdf' | 'csv_dashboard' | 'visualization');
                    if (e.target.value === 'loans') {
                      setRightPdfId(null);
                      setRightCsvDashboardId(null);
                      setRightVisualizationDashboardId(null);
                    } else if (e.target.value === 'pdf') {
                      setRightCsvDashboardId(null);
                      setRightVisualizationDashboardId(null);
                    } else if (e.target.value === 'csv_dashboard') {
                      setRightPdfId(null);
                      setRightVisualizationDashboardId(null);
                    } else if (e.target.value === 'visualization') {
                      setRightPdfId(null);
                      setRightCsvDashboardId(null);
                    }
                  }}
                  className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                >
                  <option value="loans">持出一覧</option>
                  <option value="pdf">PDF</option>
                  <option value="csv_dashboard">CSVダッシュボード</option>
                  <option value="visualization">可視化</option>
                </select>
              </div>
              {rightSlotKind === 'pdf' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700">右側のPDF</label>
                  <select
                    value={rightPdfId || ''}
                    onChange={(e) => setRightPdfId(e.target.value || null)}
                    className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  >
                    <option value="">選択してください</option>
                    {pdfsQuery.data?.map((pdf: SignagePdf) => (
                      <option key={pdf.id} value={pdf.id}>
                        {pdf.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {rightSlotKind === 'csv_dashboard' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700">右側のCSVダッシュボード</label>
                  <select
                    value={rightCsvDashboardId || ''}
                    onChange={(e) => setRightCsvDashboardId(e.target.value || null)}
                    className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  >
                    <option value="">選択してください</option>
                    {csvDashboardsQuery.data?.map((dashboard: CsvDashboard) => (
                      <option key={dashboard.id} value={dashboard.id}>
                        {dashboard.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {rightSlotKind === 'visualization' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="signage-right-visualization">
                    右側の可視化
                  </label>
                  <VisualizationDashboardGroupedSelect
                    id="signage-right-visualization"
                    value={rightVisualizationDashboardId}
                    onChange={setRightVisualizationDashboardId}
                    dashboards={visualizationDashboardsQuery.data}
                    isListPending={visualizationDashboardsQuery.isPending}
                    isListError={visualizationDashboardsQuery.isError}
                  />
                  <VisualizationDashboardSelectHelp />
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div>
            <label className="block text-sm font-semibold text-slate-700">コンテンツタイプ（旧形式）</label>
            <select
              value={formData.contentType || 'TOOLS'}
              onChange={(e) => setFormData({ ...formData, contentType: e.target.value as 'TOOLS' | 'PDF' | 'SPLIT' })}
              className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
            >
              <option value="TOOLS">工具管理データ</option>
              <option value="PDF">PDF</option>
              <option value="SPLIT">分割表示（工具+PDF）</option>
            </select>
          </div>
          {(formData.contentType === 'PDF' || formData.contentType === 'SPLIT') && (
            <div>
              <label className="block text-sm font-semibold text-slate-700">PDF</label>
              <select
                value={formData.pdfId || ''}
                onChange={(e) => setFormData({ ...formData, pdfId: e.target.value || null })}
                className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
              >
                <option value="">選択してください</option>
                {pdfsQuery.data?.map((pdf: SignagePdf) => (
                  <option key={pdf.id} value={pdf.id}>
                    {pdf.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
      <div>
        <label className="block text-sm font-semibold text-slate-700">曜日</label>
        <div className="mt-1 flex gap-2">
          {DAYS_OF_WEEK.map((day) => (
            <button
              key={day.value}
              type="button"
              onClick={() => toggleDayOfWeek(day.value)}
              className={`rounded-md border-2 px-3 py-1 text-sm font-semibold shadow-lg ${
                formData.dayOfWeek?.includes(day.value)
                  ? 'border-emerald-700 bg-emerald-600 text-white'
                  : 'border-slate-500 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              {day.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700">開始時刻</label>
          <input
            type="time"
            value={formData.startTime || ''}
            onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
            className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700">終了時刻</label>
          <input
            type="time"
            value={formData.endTime || ''}
            onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
            className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-semibold text-slate-700">優先順位</label>
        <input
          type="number"
          value={formData.priority || 0}
          onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value, 10) })}
          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
        />
      </div>
      <SignageTargetClientsField
        allClients={clientsForSignageQuery.data ?? []}
        value={formData.targetClientKeys ?? []}
        onChange={(keys) => setFormData({ ...formData, targetClientKeys: keys })}
        disabled={create.isPending || update.isPending}
      />
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={formData.enabled ?? true}
          onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
          className="rounded border-2 border-slate-500"
        />
        <label className="text-sm font-semibold text-slate-700">有効</label>
      </div>
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={create.isPending || update.isPending}>
          保存
        </Button>
        <Button onClick={handleCancel} variant="ghost" disabled={create.isPending || update.isPending}>
          キャンセル
        </Button>
      </div>
    </div>
  );
}
