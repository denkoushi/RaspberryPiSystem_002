import { isAxiosError } from 'axios';

/** The server rejected a planning-board read because the board data changed mid-read; the connection itself is fine. */
export const isStalePlanningBoardSnapshotError = (error: unknown): boolean =>
  isAxiosError(error) && error.response?.status === 409 &&
  (error.response.data as { errorCode?: unknown } | undefined)?.errorCode === 'STALE_PLANNING_BOARD_SNAPSHOT';
