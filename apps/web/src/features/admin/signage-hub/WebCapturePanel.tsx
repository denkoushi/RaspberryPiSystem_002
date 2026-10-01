import { useConfirm } from '../../../contexts/ConfirmContext';

import { PanelFrame } from './PanelFrame';

import type { WebCaptureEditor } from './useWebCaptureEditor';

/** よく撮る管理画面のページ（候補）。自由入力もできる。 */
const PATH_SUGGESTIONS: Array<{ label: string; path: string }> = [
  { label: 'データボード', path: '/admin/data-boards' },
  { label: 'ダッシュボード', path: '/admin' },
];

const REFRESH_OPTIONS: Array<{ value: 60 | 300 | 900; label: string }> = [
  { value: 60, label: '1分' },
  { value: 300, label: '5分' },
  { value: 900, label: '15分' },
];

const VIEWPORTS: Array<{ width: number; height: number }> = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
];

const TAG_LABELS: Record<string, string> = { header: '上部メニュー', nav: 'メニュー', aside: '横の欄', footer: '下部' };

/** 隠す部分の表示名。セレクタ末尾のタグ名から決め、分からなければセレクタをそのまま出す。 */
export function labelForHideSelector(selector: string): string {
  const lastPart = selector.split('>').pop()?.trim() ?? selector;
  const tag = /^[a-z]+/.exec(lastPart)?.[0] ?? '';
  return TAG_LABELS[tag] ?? selector;
}

export function WebCapturePanel({
  editor,
  onBack,
  onSaved,
}: {
  editor: WebCaptureEditor;
  onBack: () => void;
  onSaved: (webCaptureId: string, name: string, place: boolean) => void;
}) {
  const confirm = useConfirm();
  const { draft, setDraft } = editor;
  const isEdit = editor.editingId !== null;

  const handleSave = async (place: boolean) => {
    const saved = await editor.save();
    if (saved) onSaved(saved.id, saved.name, place);
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'ページ撮影を削除しますか？',
      description: `「${draft.name}」を削除します。元に戻せません。`,
      confirmLabel: '削除する',
      tone: 'danger',
    });
    if (ok && (await editor.removeCurrent())) onBack();
  };

  return (
    <PanelFrame
      title={isEdit ? 'ページ撮影を編集' : 'ページ撮影を追加'}
      accent="var(--sh-kind-web_page)"
      onBack={onBack}
      headerAction={
        isEdit ? (
          <button type="button" className="sh-icon-btn" onClick={() => void handleDelete()} aria-label="このページ撮影を削除" style={{ color: '#ff8a8a' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M6 6l1 14h10l1-14" />
            </svg>
          </button>
        ) : undefined
      }
      footer={
        <>
          <button type="button" className="sh-btn" style={{ flex: 1 }} onClick={() => void editor.runPreview()} disabled={editor.isPreviewing}>
            {editor.isPreviewing ? '撮影中…' : editor.preview ? '撮り直す' : '試し撮り'}
          </button>
          <button type="button" className="sh-btn sh-btn-lime" style={{ flex: 2 }} onClick={() => void handleSave(true)} disabled={editor.isSaving}>
            保存して予定に置く
          </button>
        </>
      }
    >
      <div className="sh-fld">
        <label className="sh-flbl" htmlFor="sh-wc-path">
          撮るページ（管理画面内のパス）
        </label>
        <input
          id="sh-wc-path"
          className="sh-input sh-mono"
          value={draft.path}
          onChange={(e) => setDraft({ ...draft, path: e.target.value })}
          placeholder="/admin/..."
          autoComplete="off"
          spellCheck={false}
        />
        <div className="sh-filter" style={{ alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--sh-faint)' }}>候補</span>
          {PATH_SUGGESTIONS.map((suggestion) => (
            <button key={suggestion.path} type="button" className="sh-pill" style={{ height: 24 }} onClick={() => setDraft({ ...draft, path: suggestion.path })}>
              {suggestion.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 150px', gap: 12 }}>
        <div className="sh-fld">
          <span className="sh-flbl">画面サイズ</span>
          <div className="sh-seg">
            {VIEWPORTS.map((viewport) => (
              <button
                key={viewport.width}
                type="button"
                aria-pressed={draft.viewportWidth === viewport.width}
                onClick={() => setDraft({ ...draft, viewportWidth: viewport.width, viewportHeight: viewport.height })}
              >
                {viewport.width}×{viewport.height}
              </button>
            ))}
          </div>
        </div>
        <div className="sh-fld">
          <span className="sh-flbl">更新</span>
          <div className="sh-seg">
            {REFRESH_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={draft.refreshIntervalSeconds === option.value}
                onClick={() => setDraft({ ...draft, refreshIntervalSeconds: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sh-fld">
        <span className="sh-flbl">撮るタイミング</span>
        <div className="sh-seg">
          <button type="button" aria-pressed={draft.waitMode === 'network_idle'} onClick={() => setDraft({ ...draft, waitMode: 'network_idle' })}>
            読み込み完了を自動判定
          </button>
          <button type="button" aria-pressed={draft.waitMode === 'fixed_delay'} onClick={() => setDraft({ ...draft, waitMode: 'fixed_delay', waitSeconds: 3 })}>
            3秒待つ
          </button>
        </div>
      </div>

      <div className="sh-fld">
        <span className="sh-flbl">隠す部分</span>
        <div className="sh-filter" style={{ alignItems: 'center' }}>
          {draft.hideSelectors.map((selector) => {
            const label = labelForHideSelector(selector);
            return (
              <span key={selector} className="sh-tag" title={selector}>
                {label}
                <button type="button" onClick={() => editor.toggleHideSelector(selector)} aria-label={`${label} を隠すのをやめる`}>
                  ×
                </button>
              </span>
            );
          })}
          {draft.hideSelectors.length === 0 && <span className="sh-hint">なし</span>}
        </div>
        <p className="sh-hint" style={{ margin: 0 }}>
          試し撮りのあと、左のプレビューで枠を押すと、その部分を隠せます。
        </p>
      </div>

      <div className="sh-fld">
        <label className="sh-flbl" htmlFor="sh-wc-name">
          名前
        </label>
        <input id="sh-wc-name" className="sh-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} />
        {editor.error && (
          <p className="sh-error" role="alert" style={{ margin: 0 }}>
            {editor.error}
          </p>
        )}
      </div>

      <button type="button" className="sh-mini-btn" style={{ alignSelf: 'flex-start' }} onClick={() => void handleSave(false)} disabled={editor.isSaving}>
        保存だけする
      </button>
    </PanelFrame>
  );
}
