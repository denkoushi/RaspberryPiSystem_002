/** キオスク共通パネル/カード面（ダークシェル上のセクション容器） */
export const kioskPanelClassName = 'rounded-lg border border-white/15 bg-slate-900/60';

/** パネル内ヘッダ行・セクションタイトル */
export const kioskSectionTitleClassName = 'text-base font-semibold text-white';

/** ページタイトル（主要見出し） */
export const kioskPageTitleClassName = 'text-xl font-bold text-white';

/** メタ情報・補足テキスト */
export const kioskMetaTextClassName = 'text-xs text-white/60';

/** テキスト入力欄（ダークシェル用） */
export const kioskInputClassName =
  'rounded-md border border-white/20 bg-slate-950/60 px-3 text-white placeholder:text-white/40 focus:border-sky-400 focus:outline-none min-h-11';

/** セレクトボックス（入力欄と同系） */
export const kioskSelectClassName =
  'rounded-md border border-white/20 bg-slate-950/60 px-3 text-white focus:border-sky-400 focus:outline-none min-h-11';

/** キオスクタップコントロールの最小タッチ高さ（44px） */
export const kioskTapTargetMinHeightClassName = 'min-h-11';

/** キオスクボタン共通ベース（角丸・パディング・無効時） */
export const kioskButtonBaseClassName =
  'rounded-md px-4 font-semibold min-h-11 disabled:cursor-not-allowed disabled:opacity-40';

/** プライマリ操作ボタン（emerald・次に取るべき操作） */
export const kioskButtonPrimaryClassName =
  `${kioskButtonBaseClassName} bg-emerald-500 text-white hover:bg-emerald-600`;

/** セカンダリ操作ボタン（枠線・低強調） */
export const kioskButtonSecondaryClassName =
  `${kioskButtonBaseClassName} border border-white/20 bg-white/5 text-white hover:bg-white/10`;

/** 危険操作ボタン（取消・削除等） */
export const kioskButtonDangerClassName =
  `${kioskButtonBaseClassName} bg-red-600 text-white hover:bg-red-500`;

/** 手順ステップカード（非アクティブ） */
export const kioskStepCardInactiveClassName =
  `${kioskPanelClassName} border-white/15 p-4 text-white/80`;

/** 手順ステップカード（現在ステップ・emerald強調） */
export const kioskStepCardActiveClassName =
  'rounded-lg border-2 border-emerald-400 bg-emerald-600 p-4 text-white';

/** 成功フィードバック面（登録完了等） */
export const kioskSuccessPanelClassName =
  'rounded-lg border-2 border-emerald-500 bg-emerald-600/90 p-4 text-left text-white';

/** エラーフィードバック面 */
export const kioskErrorPanelClassName = 'rounded-lg border border-red-500/50 bg-red-950/60 p-4 text-left';

/** 情報フィードバック面（待機・処理中等） */
export const kioskInfoPanelClassName = 'rounded-lg border border-white/15 bg-slate-900/60 p-4';

/** 画像モーダル閉じるボタン（44pxタッチターゲット） */
export const kioskModalCloseButtonClassName =
  'absolute right-2 top-2 flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/20 bg-slate-900/80 text-lg text-white hover:bg-slate-800';
