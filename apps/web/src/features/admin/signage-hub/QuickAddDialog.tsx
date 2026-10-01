import { useEffect, useMemo, useRef, useState } from 'react';

import { previewSignageWebCapture } from '../../../api/client';
import { getApiErrorMessage } from '../../../api/errors';
import { useSignagePdfMutations, useSignageScheduleMutations, useSignageWebCaptureMutations } from '../../../api/hooks';
import { Dialog } from '../../../components/ui/Dialog';

import {
  buildQuickSchedulePayload,
  DEFAULT_QUICK_WHEN,
  normalizePagePath,
  validateQuickWhen,
  type QuickContent,
  type QuickWhen,
} from './playlistModel';
import { labelForHideSelector } from './WebCapturePanel';
import { WhenEditor } from './WhenEditor';

import type {
  ClientDevice,
  CsvDashboard,
  SignageWebCapturePreview,
  VisualizationDashboard,
} from '../../../api/client';

type Source = 'page' | 'file' | 'board';

const BUILTIN_BOARDS: Array<{ kind: 'loans' | 'self_inspection_machine_board' | 'mobile_placement_parts_shelf_grid'; name: string }> = [
  { kind: 'loans', name: '持出一覧' },
  { kind: 'self_inspection_machine_board', name: '自主検査 部品別進捗' },
  { kind: 'mobile_placement_parts_shelf_grid', name: '配膳 部品棚 9枠' },
];

const VIEWPORT = { viewportWidth: 1920, viewportHeight: 1080 } as const;

/**
 * 「映す」: 何を映すか（ページ・ファイル・ボード）→ どの画面に → 映す、を 1 枚で済ませる。
 * 既定は「全部の画面に、いつも」。押すと予定が 1 件でき、次の切り替えから順番に映る。
 */
export function QuickAddDialog({
  isOpen,
  onClose,
  onDone,
  onAdvanced,
  clients,
  defaultClientKey,
  visualizationDashboards,
  csvDashboards,
}: {
  isOpen: boolean;
  onClose: () => void;
  onDone: (scheduleId: string) => void;
  /** 左右分割や、追加の設定が要る種類を使うときの「詳しい設定」への入口 */
  onAdvanced: () => void;
  clients: ClientDevice[];
  defaultClientKey: string | null;
  visualizationDashboards: VisualizationDashboard[];
  csvDashboards: CsvDashboard[];
}) {
  const scheduleMutations = useSignageScheduleMutations();
  const captureMutations = useSignageWebCaptureMutations();
  const pdfMutations = useSignagePdfMutations();

  const [source, setSource] = useState<Source>('page');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  const [when, setWhen] = useState<QuickWhen>(DEFAULT_QUICK_WHEN);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [path, setPath] = useState('');
  const [preview, setPreview] = useState<SignageWebCapturePreview | null>(null);
  const [capturedPath, setCapturedPath] = useState<string | null>(null);
  const [hideSelectors, setHideSelectors] = useState<string[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const fileCanvasRef = useRef<HTMLCanvasElement>(null);

  const [board, setBoard] = useState<{ content: QuickContent; name: string } | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // 開くたびに初期状態へ戻す
  useEffect(() => {
    if (!isOpen) return;
    setSource('page');
    setName('');
    setNameTouched(false);
    setTargets([]);
    setWhen(DEFAULT_QUICK_WHEN);
    setError(null);
    setPath('');
    setPreview(null);
    setCapturedPath(null);
    setHideSelectors([]);
    setFile(null);
    setBoard(null);
  }, [isOpen]);

  // 選んだ画像は URL を作らず、キャンバスへ直接描いて確認用に見せる
  const isImageFile = file !== null && file.type.startsWith('image/');
  useEffect(() => {
    const canvas = fileCanvasRef.current;
    if (!file || !isImageFile || !canvas || typeof createImageBitmap !== 'function') return;
    let cancelled = false;
    void createImageBitmap(file)
      .then((bitmap) => {
        if (cancelled) return;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        bitmap.close();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [file, isImageFile]);

  const suggestName = (value: string) => {
    if (!nameTouched) setName(value);
  };

  const capture = async (nextHide: string[] | null) => {
    const normalized = normalizePagePath(path, window.location.origin);
    if (!normalized.ok) {
      setError(normalized.reason);
      return;
    }
    const trimmed = normalized.path;
    setPath(trimmed);
    setIsCapturing(true);
    setError(null);
    try {
      const result = await previewSignageWebCapture(
        { path: trimmed, ...VIEWPORT, waitMode: 'network_idle', waitSeconds: 3, hideSelectors: nextHide ?? [], clipSelector: null },
        { autoHideLandmarks: nextHide === null },
      );
      setPreview(result);
      setCapturedPath(trimmed);
      setHideSelectors(nextHide ?? result.autoHiddenSelectors);
      if (result.pageTitle) suggestName(result.pageTitle);
    } catch (err) {
      setPreview(null);
      setCapturedPath(null);
      setError(getApiErrorMessage(err, 'ページを撮れませんでした'));
    } finally {
      setIsCapturing(false);
    }
  };

  const boardOptions = useMemo(
    () => [
      ...BUILTIN_BOARDS.map((entry) => ({ key: `builtin:${entry.kind}`, name: entry.name, content: { type: 'builtin', kind: entry.kind } as QuickContent })),
      ...visualizationDashboards
        .filter((dashboard) => dashboard.enabled)
        .map((dashboard) => ({ key: `viz:${dashboard.id}`, name: dashboard.name, content: { type: 'visualization', visualizationDashboardId: dashboard.id } as QuickContent })),
      ...csvDashboards
        .filter((dashboard) => dashboard.enabled)
        .map((dashboard) => ({ key: `csv:${dashboard.id}`, name: `${dashboard.name}（表）`, content: { type: 'csv_dashboard', csvDashboardId: dashboard.id } as QuickContent })),
    ],
    [visualizationDashboards, csvDashboards],
  );

  const ready =
    source === 'page' ? preview !== null && capturedPath === path.trim() : source === 'file' ? file !== null : board !== null;

  const submit = async () => {
    setError(null);
    if (name.trim() === '') {
      setError('名前を入力してください');
      return;
    }
    const whenProblem = validateQuickWhen(when);
    if (whenProblem) {
      setError(whenProblem);
      return;
    }
    setIsSubmitting(true);
    try {
      let content: QuickContent;
      if (source === 'page') {
        const created = await captureMutations.create.mutateAsync({
          name: name.trim(),
          path: path.trim(),
          ...VIEWPORT,
          waitMode: 'network_idle',
          waitSeconds: 3,
          hideSelectors,
          clipSelector: null,
          refreshIntervalSeconds: 300,
          enabled: true,
        });
        // 最初の 1 枚をすぐ撮っておく（待たない。失敗しても次の定期撮影でやり直す）
        captureMutations.captureNow.mutate(created.id);
        content = { type: 'web_page', webCaptureId: created.id };
      } else if (source === 'file') {
        if (!file) return;
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        const pdf = await pdfMutations.upload.mutateAsync({
          file,
          name: name.trim(),
          displayMode: isPdf ? 'SLIDESHOW' : 'SINGLE',
          slideInterval: isPdf ? 20 : null,
        });
        content = { type: 'pdf', pdfId: pdf.id, displayMode: pdf.displayMode, slideInterval: pdf.slideInterval ?? null };
      } else {
        if (!board) return;
        content = board.content;
      }
      const schedule = await scheduleMutations.create.mutateAsync(
        buildQuickSchedulePayload({ name, content, targetClientKeys: targets, when }),
      );
      onDone(schedule.id);
    } catch (err) {
      setError(getApiErrorMessage(err, '映せませんでした'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleTarget = (apiKey: string) =>
    setTargets((previous) => (previous.includes(apiKey) ? previous.filter((key) => key !== apiKey) : [...previous, apiKey]));

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="何を映しますか？" size="full" className="signage-hub sh-dialog sh-quick" initialFocusRef={urlInputRef}>
      <div className="sh-quick-sources">
        {(
          [
            ['page', 'ページ'],
            ['file', 'PDF・画像'],
            ['board', 'ボード'],
          ] as Array<[Source, string]>
        ).map(([value, label]) => (
          <button key={value} type="button" className="sh-quick-source" aria-pressed={source === value} onClick={() => { setSource(value); setError(null); }}>
            {label}
          </button>
        ))}
      </div>

      <div className="sh-quick-body">
        <div className="sh-col" style={{ gap: 12, minWidth: 0 }}>
          {source === 'page' && (
            <>
              <label className="sh-flbl" htmlFor="sh-q-url">
                映したいページの URL を貼る（この管理画面やキオスクのページ）
              </label>
              <form
                className="sh-quick-url"
                onSubmit={(event) => {
                  event.preventDefault();
                  void capture(null);
                }}
              >
                <input
                  id="sh-q-url"
                  ref={urlInputRef}
                  className="sh-mono"
                  value={path}
                  placeholder="/admin/..."
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setPath(e.target.value)}
                />
                <button type="submit" className="sh-btn" disabled={isCapturing}>
                  {isCapturing ? '撮っています…' : preview && capturedPath === path.trim() ? '撮り直す' : '撮る'}
                </button>
              </form>
              <div className="sh-stage sh-quick-stage">
                {preview ? (
                  <img src={preview.imageDataUrl} alt="撮影したページ" />
                ) : (
                  <div className="sh-stage-empty">{isCapturing ? 'ページを撮っています…' : 'URL を貼って「撮る」を押すと、ここに見え方が出ます。'}</div>
                )}
              </div>
              {preview && (
                <div className="sh-filter" style={{ alignItems: 'center' }}>
                  <span className="sh-flbl">隠したもの</span>
                  {hideSelectors.length === 0 && <span className="sh-hint">なし</span>}
                  {hideSelectors.map((selector) => (
                    <span key={selector} className="sh-tag" title={selector}>
                      {labelForHideSelector(selector)}
                      <button type="button" aria-label={`${labelForHideSelector(selector)} を隠すのをやめる`} onClick={() => void capture(hideSelectors.filter((value) => value !== selector))}>
                        ×
                      </button>
                    </span>
                  ))}
                  <span className="sh-hint">Chat ボタンは常に隠します · 5分ごとに撮り直します</span>
                </div>
              )}
            </>
          )}

          {source === 'file' && (
            <>
              <label className="sh-flbl" htmlFor="sh-q-file">
                PDF・JPEG・PNG のファイルを選ぶ
              </label>
              <input
                id="sh-q-file"
                type="file"
                className="sh-quick-file"
                accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                onChange={(e) => {
                  const next = e.target.files?.[0] ?? null;
                  setFile(next);
                  if (next) suggestName(next.name.replace(/\.(pdf|jpe?g|png)$/i, ''));
                }}
              />
              <div className="sh-stage sh-quick-stage">
                {isImageFile ? (
                  <canvas ref={fileCanvasRef} className="sh-quick-canvas" role="img" aria-label="選んだ画像" />
                ) : (
                  <div className="sh-stage-empty">{file ? `${file.name}（PDF は 20 秒ごとにページを送ります）` : 'ファイルを選ぶと、ここに出ます。'}</div>
                )}
              </div>
            </>
          )}

          {source === 'board' && (
            <>
              <span className="sh-flbl">映すボードを選ぶ</span>
              <div className="sh-quick-boards">
                {boardOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className="sh-quick-board"
                    aria-pressed={board !== null && board.name === option.name}
                    onClick={() => {
                      setBoard({ content: option.content, name: option.name });
                      suggestName(option.name.replace('（表）', ''));
                    }}
                  >
                    {option.name}
                  </button>
                ))}
              </div>
              <button type="button" className="sh-mini-btn" style={{ alignSelf: 'flex-start' }} onClick={onAdvanced}>
                左右に分ける・キオスク進捗・順位ボードは「詳しい設定」で
              </button>
            </>
          )}
        </div>

        <div className="sh-col" style={{ gap: 18 }}>
          <div className="sh-fld">
            <label className="sh-flbl" htmlFor="sh-q-name">
              名前
            </label>
            <input
              id="sh-q-name"
              className="sh-input"
              style={{ minHeight: 48, fontSize: 16, fontWeight: 600 }}
              value={name}
              maxLength={80}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
            />
          </div>
          <div className="sh-fld">
            <span className="sh-flbl">どの画面に</span>
            <div className="sh-filter">
              <button type="button" className="sh-pill sh-pill-lg" aria-pressed={targets.length === 0} onClick={() => setTargets([])}>
                全部
              </button>
              {clients.map((client) => (
                <button key={client.id} type="button" className="sh-pill sh-pill-lg" aria-pressed={targets.includes(client.apiKey)} onClick={() => toggleTarget(client.apiKey)}>
                  {client.name}
                </button>
              ))}
            </div>
            {defaultClientKey && targets.length === 0 && clients.length > 1 && <span className="sh-hint">選ばなければ、すべての画面に映ります。</span>}
          </div>
          <div className="sh-fld">
            <span className="sh-flbl">いつ</span>
            <WhenEditor value={when} onChange={setWhen} idPrefix="sh-q-when" />
          </div>
          {error && (
            <p className="sh-error" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          )}
          <button type="button" className="sh-go" style={{ marginTop: 'auto' }} onClick={() => void submit()} disabled={!ready || isSubmitting}>
            {isSubmitting ? '映しています…' : '映す'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
