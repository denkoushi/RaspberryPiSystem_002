const JstDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

export function resolveInspectionDateJst(date = new Date()): string {
  const parts = JstDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error('Failed to resolve JST inspection date');
  }
  return `${year}-${month}-${day}`;
}

export function resolveSelfInspectionEffectiveDateJst(session: { completedAt?: Date | null }): string {
  return resolveInspectionDateJst(session.completedAt ?? new Date());
}
