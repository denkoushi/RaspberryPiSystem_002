export const normalizeDueDateInput = (value: string | null): string => {
  if (!value) return '';
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
};

export const movePriorityItem = (items: string[], index: number, direction: -1 | 1): string[] => {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) {
    return items;
  }
  const next = [...items];
  const [picked] = next.splice(index, 1);
  next.splice(nextIndex, 0, picked);
  return next;
};

export const deriveGlobalRankFlags = (meta: {
  isInTodayTriage: boolean;
  isCarryover: boolean;
}): {
  isInTodayTriage: boolean;
  isCarryover: boolean;
  isOutOfToday: boolean;
} => {
  const isCarryover = Boolean(meta.isCarryover);
  const isInTodayTriage = isCarryover ? false : Boolean(meta.isInTodayTriage);
  return {
    isInTodayTriage,
    isCarryover,
    isOutOfToday: !isInTodayTriage
  };
};
