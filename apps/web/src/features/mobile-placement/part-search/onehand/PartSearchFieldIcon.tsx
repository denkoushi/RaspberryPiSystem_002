import type { PartSearchQuery } from '@raspi-system/part-search-core';

export const PART_SEARCH_FIELD_LABELS = { all: '全部', seiban: '製番', hinban: '品番', machine: '機種', name: '品名' } as const;

export function PartSearchFieldIcon({ field }: { field: PartSearchQuery['field'] }) {
  return <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {field === 'all' && <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>}
    {field === 'seiban' && <path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16" />}
    {field === 'hinban' && <path d="M4 6v12M7.5 6v12M11 6v12M14 6v12M17 6v12M20 6v12" />}
    {field === 'machine' && <><rect x="3" y="7" width="18" height="11" rx="2" /><path d="M7 7V4h10v3M7 18v2M17 18v2" /><circle cx="15.5" cy="12.5" r="2" /></>}
    {field === 'name' && <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9" />}
  </svg>;
}
