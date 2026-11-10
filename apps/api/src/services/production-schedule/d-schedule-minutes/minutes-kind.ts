export type DScheduleMinutesKind = 'D_COMPANY' | 'INTERNAL';

export const minutesName = (kind: DScheduleMinutesKind): string =>
  kind === 'D_COMPANY' ? 'D社日程会議議事録' : '日程会議議事録';
