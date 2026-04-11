/**
 * 画像 OCR の用途別プロファイル（ImageOcrPort の optional 入力）。
 * 具体エンジン設定は adapter 内に閉じ、route / UI には漏らさない。
 */
export type ImageOcrProfile =
  /** ラベル文脈（日本語＋英字）。製造オーダ／注文番号／製番ラベル検出用 */
  | 'actualSlipLabels'
  /** 製造 order（10 桁）抽出用。数字に制限して誤認を抑える */
  | 'actualSlipManufacturingDigits'
  /** FSEIBAN 等の英数字候補。英字主体でひらがな誤認を抑える */
  | 'actualSlipAuxiliaryAlnum';
