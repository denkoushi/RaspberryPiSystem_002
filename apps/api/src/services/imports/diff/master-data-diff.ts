type DiffResult<T> = {
  data: Partial<T>;
  hasChanges: boolean;
};

function isSameValue(current: unknown, value: unknown): boolean {
  if (current instanceof Date && value instanceof Date) {
    return current.getTime() === value.getTime();
  }
  if (current == null && value == null) {
    return true;
  }
  return Object.is(current, value);
}

export function buildUpdateDiff<T extends Record<string, unknown>>(
  existing: T,
  next: Partial<T>
): DiffResult<T> {
  const data: Partial<T> = {};
  for (const [key, value] of Object.entries(next)) {
    // Prisma は undefined を「変更しない」と扱うため、差分に含めない。
    if (value === undefined) {
      continue;
    }
    const current = existing[key as keyof T];
    if (!isSameValue(current, value)) {
      (data as Record<string, unknown>)[key] = value;
    }
  }
  return { data, hasChanges: Object.keys(data).length > 0 };
}
