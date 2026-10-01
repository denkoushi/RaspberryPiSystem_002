import { getApiErrorMessage } from '../../../api/errors';
import { useConfirm } from '../../../contexts/ConfirmContext';

import {
  detectGraphTemplate,
  GRAPH_TEMPLATE_LABEL,
  graphFieldsFor,
  isEditableJson,
  readJsonField,
  writeJsonField,
  type GraphField,
} from './graphFieldModel';

import type { VisualizationDashboardEditor } from '../visualization-dashboards/useVisualizationDashboardEditor';

/**
 * グラフ系ボードの設定。ひな形ごとの項目だけを入力欄にし、JSON は「詳しい設定」に畳む。
 * 状態と保存は既存の useVisualizationDashboardEditor をそのまま使う（保存形式は変えない）。
 */
export function GraphBoardForm({ editor, onSaved }: { editor: VisualizationDashboardEditor; onSaved: () => void }) {
  const confirm = useConfirm();
  const template = detectGraphTemplate(editor.dataSourceType);
  const fields = graphFieldsFor(template);
  const dataSourceEditable = isEditableJson(editor.dataSourceConfig);
  const rendererEditable = isEditableJson(editor.rendererConfig);
  const isSaving = editor.create.isPending || editor.update.isPending;
  const saveError = editor.create.isError
    ? getApiErrorMessage(editor.create.error, '保存できませんでした')
    : editor.update.isError
      ? getApiErrorMessage(editor.update.error, '保存できませんでした')
      : null;
  const missingSourceTable = template === 'uninspected' && !editor.currentCsvDashboardId;

  const valueOf = (field: GraphField) =>
    readJsonField(field.target === 'dataSource' ? editor.dataSourceConfig : editor.rendererConfig, field.key);
  const setValue = (field: GraphField, raw: string) => {
    if (field.target === 'dataSource') editor.setDataSourceConfig(writeJsonField(editor.dataSourceConfig, field, raw));
    else editor.setRendererConfig(writeJsonField(editor.rendererConfig, field, raw));
  };

  const handleSave = async () => {
    try {
      await editor.handleSave();
      onSaved();
    } catch {
      // 失敗の理由は saveError として下に表示する
    }
  };

  const handleDelete = async () => {
    const target = editor.selected;
    if (!target) return;
    const ok = await confirm({
      title: 'このボードを削除しますか？',
      description: `「${target.name}」を削除します。サイネージの予定で使っている場合、その予定は表示できなくなります。`,
      confirmLabel: '削除する',
      tone: 'danger',
    });
    if (!ok) return;
    await editor.remove.mutateAsync(target.id);
    editor.handleSelectChange(null);
    onSaved();
  };

  const machines = editor.palletVizBoardQuery.data?.machines ?? [];

  return (
    <div className="sh-col" style={{ gap: 16 }}>
      <div className="sh-row-between">
        <span className="sh-kind sh-kind-graph" style={{ height: 22, fontSize: 11 }}>
          {GRAPH_TEMPLATE_LABEL[template]}
        </span>
        <button type="button" role="switch" aria-checked={editor.enabled} className="sh-switch" onClick={() => editor.setEnabled(!editor.enabled)}>
          <span className="sh-switch-label">有効</span>
          <span className="sh-switch-track" aria-hidden="true">
            <span />
          </span>
        </button>
      </div>

      <div className="sh-fld">
        <label className="sh-flbl" htmlFor="sh-gb-name">
          名前
        </label>
        <input id="sh-gb-name" className="sh-input" value={editor.name} onChange={(e) => editor.setName(e.target.value)} maxLength={120} />
      </div>

      {template === 'uninspected' && (
        <div className="sh-fld">
          <label className="sh-flbl" htmlFor="sh-gb-source">
            元データ（点検結果の表）
          </label>
          <select id="sh-gb-source" className="sh-input sh-select" value={editor.currentCsvDashboardId} onChange={(e) => editor.handleCsvDashboardIdChange(e.target.value)}>
            <option value="">選んでください</option>
            {editor.csvDashboards.map((dashboard) => (
              <option key={dashboard.id} value={dashboard.id}>
                {dashboard.name}
                {dashboard.enabled ? '' : '（無効）'}
              </option>
            ))}
          </select>
          {missingSourceTable && <span className="sh-error">元データの表を選んでください。</span>}
        </div>
      )}

      {template === 'pallet' && (
        <div className="sh-fld">
          <div className="sh-row-between">
            <span className="sh-flbl">対象の加工機</span>
            <button type="button" className="sh-pill sh-pill-sm" aria-pressed={editor.palletVizSelectedMachineSet.size === 0} onClick={editor.handlePalletVizClearTargets}>
              全台
            </button>
          </div>
          <div className="sh-filter" style={{ maxHeight: 120, overflowY: 'auto' }}>
            {editor.palletVizBoardQuery.isLoading && <span className="sh-hint">加工機を読み込み中…</span>}
            {editor.palletVizBoardQuery.isError && <span className="sh-error">加工機の一覧を取得できませんでした。</span>}
            {machines.map((machine) => (
              <button
                key={machine.machineCd}
                type="button"
                className="sh-pill"
                aria-pressed={editor.palletVizSelectedMachineSet.has(machine.machineCd.trim().toUpperCase())}
                onClick={() => editor.handlePalletVizMachineToggle(machine.machineCd)}
                title={machine.machineCd}
              >
                {machine.machineName}
              </button>
            ))}
          </div>
          <span className="sh-hint">選ばなければ全台。1 台だけ選ぶと、その機械を大きく表示します。</span>
        </div>
      )}

      {fields.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          {fields.map((field) => {
            const id = `sh-gb-${field.target}-${field.key}`;
            const editable = field.target === 'dataSource' ? dataSourceEditable : rendererEditable;
            return (
              <div key={id} className="sh-fld">
                <label className="sh-flbl" htmlFor={id}>
                  {field.label}
                </label>
                <input
                  id={id}
                  type={field.kind === 'date' ? 'date' : 'text'}
                  className={field.kind === 'text' ? 'sh-input' : 'sh-input sh-mono'}
                  style={field.kind === 'date' ? { colorScheme: 'dark' } : undefined}
                  inputMode={field.kind === 'number' ? 'numeric' : undefined}
                  value={valueOf(field)}
                  placeholder={field.placeholder}
                  disabled={!editable}
                  onChange={(e) => setValue(field, e.target.value)}
                />
              </div>
            );
          })}
        </div>
      )}
      {(!dataSourceEditable || !rendererEditable) && (
        <p className="sh-error" role="alert" style={{ margin: 0 }}>
          JSON の書式が正しくありません。「詳しい設定」で直してください。
        </p>
      )}

      <details className="sh-details" open={template === 'custom' || !dataSourceEditable || !rendererEditable || undefined}>
        <summary>詳しい設定（説明・種類・JSON）</summary>
        <div className="sh-col" style={{ gap: 12, paddingTop: 12 }}>
          <div className="sh-fld">
            <label className="sh-flbl" htmlFor="sh-gb-description">
              説明
            </label>
            <input id="sh-gb-description" className="sh-input" value={editor.description} onChange={(e) => editor.setDescription(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <div className="sh-fld">
              <label className="sh-flbl" htmlFor="sh-gb-ds-type">
                データの種類
              </label>
              <input id="sh-gb-ds-type" className="sh-input sh-mono" style={{ fontSize: 12 }} value={editor.dataSourceType} onChange={(e) => editor.setDataSourceType(e.target.value)} spellCheck={false} />
            </div>
            <div className="sh-fld">
              <label className="sh-flbl" htmlFor="sh-gb-r-type">
                描き方の種類
              </label>
              <input id="sh-gb-r-type" className="sh-input sh-mono" style={{ fontSize: 12 }} value={editor.rendererType} onChange={(e) => editor.setRendererType(e.target.value)} spellCheck={false} />
            </div>
          </div>
          <div className="sh-fld">
            <label className="sh-flbl" htmlFor="sh-gb-ds-json">
              データの設定（JSON）
            </label>
            <textarea id="sh-gb-ds-json" className="sh-textarea sh-mono sh-code" rows={5} value={editor.dataSourceConfig} onChange={(e) => editor.setDataSourceConfig(e.target.value)} spellCheck={false} />
          </div>
          <div className="sh-fld">
            <label className="sh-flbl" htmlFor="sh-gb-r-json">
              描き方の設定（JSON）
            </label>
            <textarea id="sh-gb-r-json" className="sh-textarea sh-mono sh-code" rows={4} value={editor.rendererConfig} onChange={(e) => editor.setRendererConfig(e.target.value)} spellCheck={false} />
          </div>
        </div>
      </details>

      {(editor.formError ?? saveError) && (
        <p className="sh-error" role="alert" style={{ margin: 0 }}>
          {editor.formError ?? saveError}
        </p>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {!editor.isCreating && (
          <button type="button" className="sh-icon-btn" style={{ color: '#ff8a8a', width: 40, height: 40 }} aria-label="このボードを削除" onClick={() => void handleDelete()} disabled={editor.remove.isPending}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M6 6l1 14h10l1-14" />
            </svg>
          </button>
        )}
        {editor.isCreating && (
          <button type="button" className="sh-btn" style={{ flex: 1 }} onClick={() => editor.setIsCreating(false)} disabled={isSaving}>
            やめる
          </button>
        )}
        <button
          type="button"
          className={editor.isCreating || editor.isDirty ? 'sh-btn sh-btn-primary' : 'sh-btn'}
          style={{ flex: 2 }}
          onClick={() => void handleSave()}
          disabled={isSaving || missingSourceTable || (!editor.isCreating && !editor.isDirty)}
        >
          {isSaving ? '保存中…' : editor.isCreating ? '作成' : editor.isDirty ? '保存' : '保存済み'}
        </button>
      </div>
    </div>
  );
}
