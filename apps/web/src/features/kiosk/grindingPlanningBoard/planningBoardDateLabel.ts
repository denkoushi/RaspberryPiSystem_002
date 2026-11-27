export const formatPlanningBoardDate = (date: string | null, separator = '/'): string => (date ? date.slice(5).replace('-', separator) : '未定');
