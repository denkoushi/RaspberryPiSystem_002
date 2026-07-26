/** 組立ドメインで一意制約競合を業務409へ変換するための共通判定。 */
export function isAssemblyUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
  );
}
