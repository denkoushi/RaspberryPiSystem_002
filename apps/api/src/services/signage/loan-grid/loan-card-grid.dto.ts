/**
 * Pure view-models for loan card rasterization (no Prisma / FS).
 */

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
