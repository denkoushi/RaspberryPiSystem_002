type DiffResult<T> = {
  data: Partial<T>;
  hasChanges: boolean;
};

export function buildUpdateDiff<T extends Record<string, unknown>>(
  existing: T,
  next: Partial<T>
): DiffResult<T> {
  const data: Partial<T> = {};
  for (const [key, value] of Object.entries(next)) {
    const current = existing[key as keyof T];
    if (!Object.is(current, value)) {
      (data as Record<string, unknown>)[key] = value;
    }
  }
  return { data, hasChanges: Object.keys(data).length > 0 };
}
