export const formatPlanningBoardDate = (date: string | null): string => (date ? date.slice(5).replace('-', '/') : '未定');
