/**
 * `MeasuringInstrumentLoanEvent.raw`（NFC ミラー等）から `loanId` を解釈する。
 * 点検可視化・取消除外など、イベント raw の解釈を一箇所に寄せる。
 */
export function extractLoanIdFromEventRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const id = (raw as Record<string, unknown>).loanId;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}
