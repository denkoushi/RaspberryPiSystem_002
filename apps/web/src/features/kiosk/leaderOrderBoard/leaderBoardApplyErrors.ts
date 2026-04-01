export type LeaderBoardApplyErrorCode =
  | 'INCOMPLETE_PAGE'
  | 'TOO_MANY_ROWS'
  | 'EMPTY_RESOURCE'
  | 'RESOURCE_MISMATCH';

export class LeaderBoardApplyError extends Error {
  readonly code: LeaderBoardApplyErrorCode;

  constructor(code: LeaderBoardApplyErrorCode, message: string) {
    super(message);
    this.name = 'LeaderBoardApplyError';
    this.code = code;
  }
}
