/**
 * Pure view-models for loan card rasterization (no Prisma / FS).
 */

/**
 * Kiosk `/kiosk/tag` 持出一覧（`presentActiveLoanListLines`）に揃えた compact 本文。
 * 工具・写真持出などの通常アイテムでは未設定のまま（従来の primaryText 主体レイアウト）。
 */
export type LoanCardCompactKioskLines = {
  /** 1 行目左: 管理番号 */
  headLine: string;
  /** 2 行目: 名称 */
  nameLine: string;
  /**
   * 吊具のみ。1 行目右に値だけ表示（未設定は `-`）。プレフィックスなし。
   */
  idNumValue?: string;
};

export type LoanCardViewModel = {
  primaryText: string;
  employeeName: string | null;
  clientLocation: string;
  borrowedDatePart: string;
  borrowedTimePart: string;
  borrowedCompact: string;
  isInstrument: boolean;
  isRigging: boolean;
  managementText: string;
  riggingIdNumText: string;
  isExceeded: boolean;
  thumbnailDataUrl: string | null;
  /** 計測・吊具のみ。設定時は compact カード本文・サムネ列ポリシーをキオスク準拠に切替 */
  compactKioskLines?: LoanCardCompactKioskLines;
};

export type LoanGridPlacedCard = {
  view: LoanCardViewModel;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LoanGridLayout = {
  gap: number;
  columns: number;
  cardWidth: number;
  cardHeight: number;
  overflowCount: number;
  scale: number;
  /** Absolute coordinates on the signage canvas */
  placed: LoanGridPlacedCard[];
  /** When no items */
  isEmpty: boolean;
};
