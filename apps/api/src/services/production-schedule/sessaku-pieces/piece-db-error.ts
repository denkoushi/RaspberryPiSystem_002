/** Prisma native and PG driver-adapter errors expose SQLSTATE in different places. */
export function sessakuPieceSqlState(error: unknown): string | undefined {
  const meta = (error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } } | null)?.meta;
  return meta?.driverAdapterError?.cause?.originalCode ?? meta?.code;
}

export function isAutoUnitSplitBusyError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'P2028' || code === 'P2024' || ['55P03', '57014'].includes(sessakuPieceSqlState(error) ?? '');
}
