import { useState } from 'react';

import { getApiErrorMessage } from '../../../api/errors';
import { toUnifiedColumns } from '../csv-dashboards/csvDashboardFormModel';
import { CsvDashboardPreviewSection } from '../csv-dashboards/CsvDashboardPreviewSection';
import { CsvDashboardUploadSection } from '../csv-dashboards/CsvDashboardUploadSection';

import type { CsvDashboard } from '../../../api/client';
import type { CsvDashboardEditor } from '../csv-dashboards/useCsvDashboardEditor';

type Tab = 'columns' | 'look' | 'import';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'columns', label: '列' },
  { value: 'look', label: '見た目' },
  { value: 'import', label: '取り込み' },
];

const TYPE_LABEL: Record<string, string> = { string: '文字', number: '数値', date: '日付', boolean: '真偽' };

/**
 * 表（CSV ダッシュボード）の設定。列の定義と「表に出すか・出す順」を 1 つのリストで扱う。
 * 状態と保存は既存の useCsvDashboardEditor をそのまま使う（保存形式は変えない）。
 */
export function TableBoardForm({ editor, selected, onSaved }: { editor: CsvDashboardEditor; selected: CsvDashboard; onSaved: () => void }) {
  const [tab, setTab] = useState<Tab>('columns');
  const isTable = selected.templateType === 'TABLE';
  const columns = toUnifiedColumns(editor.normalizedColumnDefinitions, isTable ? editor.tableDisplayColumns : editor.normalizedColumnDefinitions.map((column) => column.internalName));
  const shownCount = columns.filter((column) => column.displayIndex !== null).length;
  const dateColumns = editor.normalizedColumnDefinitions.filter((column) => column.dataType === 'date');
  const { updateMutation } = editor;

  return (
    <div className="sh-col" style={{ gap: 14 }}>
      <div className="sh-row-between">
        <span className="sh-kind sh-kind-table" style={{ height: 22, fontSize: 11 }}>
          表（CSV）
        </span>
        <button type="button" role="switch" aria-checked={editor.enabled} className="sh-switch" onClick={() => editor.setEnabled(!editor.enabled)}>
          <span className="sh-switch-label">有効</span>
          <span className="sh-switch-track" aria-hidden="true">
            <span />
          </span>
        </button>
      </div>

      <div role="tablist" aria-label="表の設定" className="sh-seg">
        {TABS.map((entry) => (
          <button key={entry.value} type="button" role="tab" aria-selected={tab === entry.value} aria-pressed={tab === entry.value} onClick={() => setTab(entry.value)}>
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'columns' && (
        <div className="sh-col" style={{ gap: 8 }}>
          <div className="sh-row-between" style={{ fontSize: 12, color: 'var(--sh-muted)' }}>
            <span>表示名 ／ CSV の見出し（カンマ区切り）</span>
            {isTable && (
              <button type="button" className="sh-pill sh-pill-sm" onClick={editor.handleResetDisplayColumns}>
                全部出す
              </button>
            )}
          </div>
          {columns.map((column) => {
            const shown = column.displayIndex !== null;
            return (
              <div key={column.internalName} className="sh-colrow" data-hidden={!shown}>
                {isTable && (
                  <div className="sh-colrow-move">
                    <button
                      type="button"
                      aria-label={`${column.displayName} を上へ`}
                      disabled={!shown || column.displayIndex === 0}
                      onClick={() => column.displayIndex !== null && editor.handleMoveDisplayColumnUp(column.displayIndex)}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={`${column.displayName} を下へ`}
                      disabled={!shown || column.displayIndex === shownCount - 1}
                      onClick={() => column.displayIndex !== null && editor.handleMoveDisplayColumnDown(column.displayIndex)}
                    >
                      ▼
                    </button>
                  </div>
                )}
                <div className="sh-col" style={{ gap: 4, flex: 1, minWidth: 0 }}>
                  <input
                    className="sh-colrow-name"
                    aria-label={`${column.internalName} の表示名`}
                    value={column.displayName}
                    onChange={(e) => editor.handleDisplayNameChange(column.definitionIndex, e.target.value)}
                  />
                  <input
                    className="sh-colrow-headers"
                    aria-label={`${column.displayName} の CSV 見出し`}
                    defaultValue={column.csvHeaderCandidates.join(', ')}
                    key={column.csvHeaderCandidates.join('|')}
                    onBlur={(e) => editor.handleCsvHeaderCandidatesChange(column.definitionIndex, e.target.value)}
                  />
                </div>
                <div className="sh-col" style={{ gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
                  <span className="sh-colrow-type" title={column.internalName}>
                    {TYPE_LABEL[column.dataType] ?? column.dataType}
                  </span>
                  <label className="sh-colrow-required">
                    <input type="checkbox" checked={column.required ?? false} onChange={(e) => editor.handleRequiredChange(column.definitionIndex, e.target.checked)} />
                    必須
                  </label>
                </div>
                {isTable && editor.manualColumnWidths && shown && (
                  <input
                    className="sh-colrow-width sh-mono"
                    aria-label={`${column.displayName} の幅（px）`}
                    inputMode="numeric"
                    placeholder="自動"
                    value={editor.tableColumnWidths[column.internalName] ?? ''}
                    onChange={(e) => editor.handleColumnWidthChange(column.internalName, e.target.value)}
                  />
                )}
                {isTable && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shown}
                    aria-label={`${column.displayName} を表に出す`}
                    className="sh-switch"
                    onClick={() =>
                      shown ? editor.handleRemoveDisplayColumn(column.internalName) : editor.setTableDisplayColumns((previous) => [...previous, column.internalName])
                    }
                  >
                    <span className="sh-switch-track" aria-hidden="true">
                      <span />
                    </span>
                  </button>
                )}
              </div>
            );
          })}
          {columns.length === 0 && <p className="sh-hint">列がまだありません。CSV を取り込むと列ができます。</p>}
        </div>
      )}

      {tab === 'look' && (
        <div className="sh-col" style={{ gap: 14 }}>
          {isTable && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <div className="sh-fld">
                <label className="sh-flbl" htmlFor="sh-tb-font">
                  文字の大きさ（px）
                </label>
                <input id="sh-tb-font" type="number" className="sh-input sh-mono" min={10} max={48} value={editor.tableFontSize} onChange={(e) => editor.setTableFontSize(Number(e.target.value))} />
              </div>
              <div className="sh-fld">
                <label className="sh-flbl" htmlFor="sh-tb-rows">
                  1ページの行数
                </label>
                <input id="sh-tb-rows" type="number" className="sh-input sh-mono" min={1} max={200} value={editor.tableRowsPerPage} onChange={(e) => editor.setTableRowsPerPage(Number(e.target.value))} />
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <div className="sh-fld">
              <label className="sh-flbl" htmlFor="sh-tb-period">
                表示する期間（日数）
              </label>
              <input id="sh-tb-period" type="number" className="sh-input sh-mono" min={1} value={editor.displayPeriodDays} onChange={(e) => editor.setDisplayPeriodDays(Number(e.target.value))} />
            </div>
            <div className="sh-fld">
              <label className="sh-flbl" htmlFor="sh-tb-datecol">
                日付の基準にする列
              </label>
              <select id="sh-tb-datecol" className="sh-input sh-select" value={editor.dateColumnName} onChange={(e) => editor.setDateColumnName(e.target.value)}>
                <option value="">なし</option>
                {dateColumns.map((column) => (
                  <option key={column.internalName} value={column.internalName}>
                    {column.displayName}
                  </option>
                ))}
                {editor.dateColumnName && !dateColumns.some((column) => column.internalName === editor.dateColumnName) && (
                  <option value={editor.dateColumnName}>{editor.dateColumnName}</option>
                )}
              </select>
            </div>
          </div>
          <div className="sh-fld">
            <label className="sh-flbl" htmlFor="sh-tb-empty">
              データがないときの文言
            </label>
            <input id="sh-tb-empty" className="sh-input" value={editor.emptyMessage} placeholder="本日のデータはありません" onChange={(e) => editor.setEmptyMessage(e.target.value)} />
          </div>
          {isTable && (
            <button type="button" role="switch" aria-checked={editor.manualColumnWidths} className="sh-switch" style={{ alignSelf: 'flex-start' }} onClick={() => editor.handleManualColumnWidthsChange(!editor.manualColumnWidths)}>
              <span className="sh-switch-track" aria-hidden="true">
                <span />
              </span>
              <span className="sh-switch-label">列の幅を自分で決める（「列」タブに入力欄が出ます）</span>
            </button>
          )}
        </div>
      )}

      {tab === 'import' && (
        <div className="sh-col" style={{ gap: 14 }}>
          <div className="sh-fld">
            <label className="sh-flbl" htmlFor="sh-tb-gmail">
              Gmail の件名（この件名のメールから CSV を取り込む）
            </label>
            <input id="sh-tb-gmail" className="sh-input" value={editor.gmailSubjectPattern} placeholder="例: 生産日程_三島_研削工程" onChange={(e) => editor.setGmailSubjectPattern(e.target.value)} />
          </div>
          <details className="sh-details" open>
            <summary>CSV を手動で取り込む</summary>
            <div className="sh-legacy" style={{ paddingTop: 10 }}>
              <CsvDashboardUploadSection editor={editor} />
            </div>
          </details>
          <details className="sh-details">
            <summary>CSV の見出しを照合して確かめる</summary>
            <div className="sh-legacy" style={{ paddingTop: 10 }}>
              <CsvDashboardPreviewSection editor={editor} />
            </div>
          </details>
        </div>
      )}

      {(editor.columnDefinitionError ?? editor.templateConfigError) && (
        <p className="sh-error" role="alert" style={{ margin: 0 }}>
          {editor.columnDefinitionError ?? editor.templateConfigError}
        </p>
      )}
      {updateMutation.isError && (
        <p className="sh-error" role="alert" style={{ margin: 0 }}>
          {getApiErrorMessage(updateMutation.error, '保存に失敗しました。')}
        </p>
      )}
      <button type="button" className="sh-btn sh-btn-primary" onClick={() => updateMutation.mutate(undefined, { onSuccess: onSaved })} disabled={updateMutation.isPending}>
        {updateMutation.isPending ? '保存中…' : updateMutation.isSuccess ? '保存しました（もう一度保存）' : '保存'}
      </button>
    </div>
  );
}
