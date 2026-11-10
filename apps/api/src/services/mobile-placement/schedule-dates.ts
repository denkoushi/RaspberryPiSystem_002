/** Excel date-only fields share the same interpretation across placement views. */
export function readScheduleDates(row: { partsCompleteDate: Date | null; surfaceSendOutDates: unknown }) {
  const dates = Array.isArray(row.surfaceSendOutDates) ? row.surfaceSendOutDates.flatMap(value => {
    const date = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).date : null;
    return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? [date] : [];
  }).sort() : [];
  return { partsCompleteDate: row.partsCompleteDate?.toISOString().slice(0, 10) ?? null, sendOutDate: dates[0] ?? null };
}
