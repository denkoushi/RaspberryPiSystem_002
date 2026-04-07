import {
  DEFAULT_LEADER_ORDER_CARDS_PER_PAGE,
  MAX_LEADER_ORDER_CARDS_PER_PAGE,
} from './layout-contracts.js';

export function sanitizeLeaderOrderCardsPerPage(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_LEADER_ORDER_CARDS_PER_PAGE;
  }
  const n = Math.floor(value);
  if (n < 1) {
    return 1;
  }
  if (n > MAX_LEADER_ORDER_CARDS_PER_PAGE) {
    return MAX_LEADER_ORDER_CARDS_PER_PAGE;
  }
  return n;
}

export function leaderOrderCardsPageCount(cardCount: number, cardsPerPage: number): number {
  if (cardsPerPage < 1) {
    return 0;
  }
  if (cardCount <= 0) {
    return 0;
  }
  return Math.ceil(cardCount / cardsPerPage);
}

export function sliceLeaderOrderCardPage<T>(
  cards: T[],
  pageIndex: number,
  cardsPerPage: number
): T[] {
  if (cardsPerPage < 1) {
    return [];
  }
  const start = pageIndex * cardsPerPage;
  return cards.slice(start, start + cardsPerPage);
}
