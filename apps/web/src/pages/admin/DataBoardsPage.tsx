import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { getApiErrorMessage } from '../../api/errors';
import { useSignageSchedulesForManagement } from '../../api/hooks';
import { CsvDashboardBasicSettingsFields } from '../../features/admin/csv-dashboards/CsvDashboardBasicSettingsFields';
import { CsvDashboardColumnDefinitionsTable } from '../../features/admin/csv-dashboards/CsvDashboardColumnDefinitionsTable';
import { CsvDashboardPreviewSection } from '../../features/admin/csv-dashboards/CsvDashboardPreviewSection';
import { CsvDashboardTableTemplateSection } from '../../features/admin/csv-dashboards/CsvDashboardTableTemplateSection';
import { CsvDashboardUploadSection } from '../../features/admin/csv-dashboards/CsvDashboardUploadSection';
import { useCsvDashboardEditor } from '../../features/admin/csv-dashboards/useCsvDashboardEditor';
import {
  buildBoardList,
  listBoardUsage,
  type BoardSelection,
  type BoardType,
} from '../../features/admin/data-boards/boardModel';
import { NewBoardDialog, type BoardTemplate } from '../../features/admin/data-boards/NewBoardDialog';
import { useBoardPreviewImage } from '../../features/admin/data-boards/useBoardPreviewImage';
import { HubStage } from '../../features/admin/signage-hub/HubStage';
import { useVisualizationDashboardEditor } from '../../features/admin/visualization-dashboards/useVisualizationDashboardEditor';
import { VisualizationDashboardEditorForm } from '../../features/admin/visualization-dashboards/VisualizationDashboardEditorForm';

import '../../features/admin/signage-hub/signageHub.css';

type Filter = 'all' | BoardType;
type TableTab = 'look' | 'columns' | 'import';

const KIND_LABEL: Record<BoardType, string> = { graph: 'グラフ', table: '表' };

function filterFromQuery(value: string | null): Filter {
  return value === 'graph' || value === 'table' ? value : 'all';
}

/**
 * データボード: サイネージやキオスクに出すグラフ（可視化ダッシュボード）と表（CSV ダッシュボード）を
 * 1 ページで一覧・プレビュー・設定する。DB と API は従来のまま、画面だけをまとめている。
 */
export function DataBoardsPage() {
  const [searchParams] = useSearchParams();
  const graphEditor = useVisualizationDashboardEditor();
  const tableEditor = useCsvDashboardEditor();
  const schedulesQuery = useSignageSchedulesForManagement();
  const [filter, setFilter] = useState<Filter>(() => filterFromQuery(searchParams.get('type')));
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<BoardSelection | null>(null);
  const [tableTab, setTableTab] = useState<TableTab>('look');
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<BoardTemplate | null>(null);
  const [previewToken, setPreviewToken] = useState(0);

  const schedules = useMemo(() => schedulesQuery.data ?? [], [schedulesQuery.data]);
  const boards = useMemo(
    () => buildBoardList(graphEditor.dashboards, tableEditor.dashboards, schedules),
    [graphEditor.dashboards, tableEditor.dashboards, schedules],
  );
  const visibleBoards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return boards.filter(
      (board) => (filter === 'all' || board.type === filter) && (needle === '' || board.name.toLowerCase().includes(needle)),
    );
  }, [boards, filter, query]);

  const select = (next: BoardSelection) => {
    setSelection(next);
    if (next.type === 'graph') {
      graphEditor.handleSelectChange(next.id);
    } else {
      graphEditor.handleSelectChange(null);
      tableEditor.setSelectedId(next.id);
    }
  };

  // 新規作成のひな形は、編集フックが入力欄を空にした後（同じコミットの後続エフェクト）で流し込む
  const {
    isCreating: isCreatingGraph,
    applyUninspectedPreset,
    applyMeasuringInspectionPreset,
    applyRiggingInspectionPreset,
    applyPalletVisualizationPreset,
  } = graphEditor;
  useEffect(() => {
    if (!isCreatingGraph || !pendingTemplate) return;
    if (pendingTemplate === 'uninspected') applyUninspectedPreset();
    else if (pendingTemplate === 'measuring') applyMeasuringInspectionPreset();
    else if (pendingTemplate === 'rigging') applyRiggingInspectionPreset();
    else if (pendingTemplate === 'pallet') applyPalletVisualizationPreset();
    setPendingTemplate(null);
    // ひな形の適用は「新規作成に入った直後の 1 回」だけ行う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreatingGraph, pendingTemplate]);

  const handlePickTemplate = (template: BoardTemplate) => {
    if (template === 'inspection_csv') {
      tableEditor.createInspectionDashboardMutation.mutate(undefined, {
        onSuccess: () => {
          setIsNewOpen(false);
          graphEditor.setIsCreating(false);
          setFilter('table');
        },
      });
      return;
    }
    setIsNewOpen(false);
    setSelection(null);
    setPendingTemplate(template === 'blank' ? null : template);
    graphEditor.setIsCreating(true);
  };

  const preview = useBoardPreviewImage(graphEditor.isCreating ? null : selection, previewToken);
  const usage = useMemo(() => (selection ? listBoardUsage(schedules, selection) : []), [schedules, selection]);
  const selectedBoard = selection ? boards.find((board) => board.type === selection.type && board.id === selection.id) : undefined;
  const sourceTableId = selection?.type === 'graph' ? graphEditor.currentCsvDashboardId : null;
  const sourceTable = sourceTableId ? tableEditor.dashboards.find((dashboard) => dashboard.id === sourceTableId) : undefined;
  const showGraphForm = graphEditor.isCreating || (selection?.type === 'graph' && graphEditor.selected);
  const selectedTable = selection?.type === 'table' ? tableEditor.selected : undefined;
  const countOf = (type: BoardType) => boards.filter((board) => board.type === type).length;

  return (
    <div className="signage-hub sh-boards">
      <div className="sh-head">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, flexWrap: 'wrap' }}>
          <h1>データボード</h1>
          <div className="sh-head-meta">サイネージやキオスクに出すグラフと表</div>
        </div>
        <button type="button" className="sh-btn sh-btn-primary" onClick={() => setIsNewOpen(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          新しいボード
        </button>
      </div>

      <div className="sh-body">
        <section aria-label="ボード一覧" className="sh-col">
          <label className="sh-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sh-faint)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input type="search" placeholder="ボードを検索" aria-label="ボードを検索" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="sh-seg">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              すべて
            </button>
            <button type="button" aria-pressed={filter === 'graph'} onClick={() => setFilter('graph')}>
              グラフ {countOf('graph')}
            </button>
            <button type="button" aria-pressed={filter === 'table'} onClick={() => setFilter('table')}>
              表 {countOf('table')}
            </button>
          </div>
          {(graphEditor.dashboardsQuery.isLoading || tableEditor.dashboardsQuery.isLoading) && <p className="sh-hint">読み込み中…</p>}
          {(graphEditor.dashboardsQuery.isError || tableEditor.dashboardsQuery.isError) && (
            <p className="sh-error" role="alert">
              一覧を取得できませんでした。
            </p>
          )}
          <div className="sh-col" style={{ gap: 4, margin: '0 -6px', overflowY: 'auto', maxHeight: 'calc(100dvh - 300px)' }}>
            {visibleBoards.length === 0 && !graphEditor.dashboardsQuery.isLoading && (
              <p className="sh-hint" style={{ padding: '0 6px' }}>
                該当するボードがありません。
              </p>
            )}
            {visibleBoards.map((board) => (
              <button
                key={`${board.type}:${board.id}`}
                type="button"
                className="sh-board-item"
                aria-pressed={!graphEditor.isCreating && selection?.type === board.type && selection.id === board.id}
                onClick={() => select({ type: board.type, id: board.id })}
              >
                <span className="sh-item-name">{board.name}</span>
                <span className="sh-item-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`sh-kind sh-kind-${board.type}`}>{KIND_LABEL[board.type]}</span>
                  {board.usedCount > 0 ? `サイネージ ${board.usedCount}件` : '未使用'}
                  {!board.enabled && <span style={{ color: 'var(--sh-warn)' }}>無効</span>}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section aria-label="プレビュー" className="sh-col" style={{ gap: 16 }}>
          <div className="sh-row-between" style={{ minHeight: 28 }}>
            <span className="sh-eyebrow">サイネージでの見え方</span>
            {selection && !graphEditor.isCreating && (
              <button type="button" className="sh-mini-btn" onClick={() => setPreviewToken((value) => value + 1)} disabled={preview.isLoading}>
                {preview.isLoading ? '描画中…' : '描き直す'}
              </button>
            )}
          </div>
          <HubStage
            imageUrl={preview.imageUrl}
            alt={selectedBoard ? `${selectedBoard.name} のプレビュー` : 'ボードのプレビュー'}
            emptyText={
              graphEditor.isCreating
                ? '保存すると、ここにプレビューが出ます。'
                : !selection
                  ? '左の一覧からボードを選んでください。'
                  : (preview.error ?? '描画中…')
            }
          />
          {selection && !graphEditor.isCreating && (
            <div style={{ display: 'grid', gridTemplateColumns: sourceTable ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)', gap: 16 }}>
              <div className="sh-panel sh-col" style={{ gap: 10 }}>
                <span className="sh-eyebrow">使われている場所</span>
                {usage.length === 0 && <p className="sh-hint" style={{ margin: 0 }}>まだサイネージの予定で使われていません。</p>}
                {usage.map((entry) => (
                  <Link key={entry.scheduleId} to="/admin/signage" className="sh-usage">
                    <span style={{ flex: 1, minWidth: 0 }}>サイネージ · {entry.scheduleName}</span>
                    <span className="sh-mono" style={{ color: 'var(--sh-muted)' }}>
                      {entry.days} {entry.time}
                    </span>
                  </Link>
                ))}
                <Link to="/admin/signage" style={{ fontSize: 12, color: '#ff8a55' }}>
                  サイネージで予定に置く →
                </Link>
              </div>
              {sourceTable && (
                <div className="sh-panel sh-col" style={{ gap: 10 }}>
                  <span className="sh-eyebrow">元データ</span>
                  <button type="button" className="sh-board-item" onClick={() => select({ type: 'table', id: sourceTable.id })}>
                    <span className="sh-item-name">{sourceTable.name}</span>
                    <span className="sh-item-meta">
                      <span className="sh-kind sh-kind-table">表</span>
                    </span>
                  </button>
                  <p className="sh-hint" style={{ margin: 0 }}>
                    この表から集計しています。表の取り込みが止まると、このボードも古いままになります。
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        <section aria-label="ボードの設定" className="sh-panel sh-col sh-right" style={{ gap: 14, alignSelf: 'start', maxHeight: 'calc(100dvh - 150px)', overflowY: 'auto' }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
            {graphEditor.isCreating ? '新しいグラフ' : selectedBoard ? selectedBoard.name : '設定'}
          </h2>
          {!showGraphForm && !selectedTable && (
            <p className="sh-hint" style={{ margin: 0 }}>
              {selection ? '読み込み中…' : '左の一覧からボードを選ぶか、「新しいボード」で作成してください。'}
            </p>
          )}

          {showGraphForm && (
            <div className="sh-legacy">
              <VisualizationDashboardEditorForm editor={graphEditor} />
            </div>
          )}

          {selectedTable && (
            <>
              <div role="tablist" aria-label="表の設定" className="sh-seg">
                {(
                  [
                    ['look', '見た目'],
                    ['columns', '列'],
                    ['import', '取り込み'],
                  ] as Array<[TableTab, string]>
                ).map(([value, label]) => (
                  <button key={value} type="button" role="tab" aria-selected={tableTab === value} aria-pressed={tableTab === value} onClick={() => setTableTab(value)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="sh-legacy sh-col" style={{ gap: 14 }}>
                {tableTab === 'look' && (
                  <>
                    <CsvDashboardBasicSettingsFields editor={tableEditor} selected={selectedTable} />
                    {selectedTable.templateType === 'TABLE' && <CsvDashboardTableTemplateSection editor={tableEditor} />}
                  </>
                )}
                {tableTab === 'columns' && (
                  <>
                    <CsvDashboardColumnDefinitionsTable editor={tableEditor} />
                    <CsvDashboardPreviewSection editor={tableEditor} />
                  </>
                )}
                {tableTab === 'import' && <CsvDashboardUploadSection editor={tableEditor} />}
              </div>
              {tableTab !== 'import' && (
                <div className="sh-col" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="sh-btn sh-btn-primary"
                    onClick={() => tableEditor.updateMutation.mutate(undefined, { onSuccess: () => setPreviewToken((value) => value + 1) })}
                    disabled={tableEditor.updateMutation.isPending}
                  >
                    {tableEditor.updateMutation.isPending ? '保存中…' : '設定を保存'}
                  </button>
                  {tableEditor.updateMutation.isError && (
                    <p className="sh-error" role="alert" style={{ margin: 0 }}>
                      {getApiErrorMessage(tableEditor.updateMutation.error, '保存に失敗しました。')}
                    </p>
                  )}
                  {tableEditor.columnDefinitionError && (
                    <p className="sh-error" role="alert" style={{ margin: 0 }}>
                      {tableEditor.columnDefinitionError}
                    </p>
                  )}
                  {tableEditor.updateMutation.isSuccess && (
                    <p className="sh-hint" role="status" style={{ margin: 0, color: 'var(--sh-ok)' }}>
                      保存しました。
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <NewBoardDialog
        isOpen={isNewOpen}
        onClose={() => setIsNewOpen(false)}
        onPick={handlePickTemplate}
        isCreatingTable={tableEditor.createInspectionDashboardMutation.isPending}
      />
    </div>
  );
}
