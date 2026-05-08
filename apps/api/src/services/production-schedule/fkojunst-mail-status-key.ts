/** メール側3キーと `ProductionScheduleFkojunstMailStatus` 周りで共通の論理キー文字列。 */
export function buildFkojunstMailStatusKey(parts: { fkojun: string; fkoteicd: string; fsezono: string }): string {
  return `${parts.fkojun}\t${parts.fkoteicd}\t${parts.fsezono}`;
}
