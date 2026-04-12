/**
 * 紙の現品票（一般的なレイアウト）向け ROI テンプレート。
 * 正規化座標は前処理後画像（幅最大2200 + 余白）に対する 0..1。
 * 実機撮影でズレる場合はこの定数を調整するか、将来テンプレート差し替えに対応する。
 */

import type { ImageOcrProfile } from '../../ocr/image-ocr-profiles.js';

/** テンプレート上の領域ID */
export type GenpyoRoiId = 'moHeader' | 'fseibanMain' | 'moFooter';

export type GenpyoNormalizedRect = {
  /** 左端 0..1 */
  x: number;
  /** 上端 0..1 */
  y: number;
  /** 幅 0..1 */
  w: number;
  /** 高さ 0..1 */
  h: number;
};

export type GenpyoRoiDefinition = {
  id: GenpyoRoiId;
  rect: GenpyoNormalizedRect;
  /** 領域に合わせた OCR プロファイル */
  profile: ImageOcrProfile;
};

/**
 * 既定テンプレート（縦長・右上に製造オーダ、左中盤に製番、下段に次工程の製造オーダ番号想定）
 */
export const DEFAULT_GENPYO_SLIP_ROIS: readonly GenpyoRoiDefinition[] = [
  {
    id: 'moHeader',
    rect: { x: 0.5, y: 0.02, w: 0.48, h: 0.18 },
    profile: 'actualSlipLabels'
  },
  {
    id: 'fseibanMain',
    rect: { x: 0.02, y: 0.14, w: 0.52, h: 0.16 },
    profile: 'actualSlipLabels'
  },
  {
    id: 'moFooter',
    rect: { x: 0.02, y: 0.74, w: 0.62, h: 0.14 },
    profile: 'actualSlipLabels'
  }
] as const;
