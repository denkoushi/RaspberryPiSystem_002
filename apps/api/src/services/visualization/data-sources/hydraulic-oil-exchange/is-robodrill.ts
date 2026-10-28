export function isRobodrill(...names: (string | null | undefined)[]): boolean {
  return names.some((name) => {
    const normalized = (name ?? '').normalize('NFKC').toUpperCase().replace(/[\s_-]/g, '');
    return normalized.includes('ROBODRIL') || normalized.includes('ロボドリル');
  });
}
