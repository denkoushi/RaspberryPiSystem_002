const paths = {
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 9v6M10 9v6M13 9v6M17 9v6',
  check: 'M4 12.5l5 5L20 6.5',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  search: 'M16 16l4.5 4.5M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  pallet: 'M3 15h18M5 15v4M12 15v4M19 15v4M5 6h6v9H5zM13 9h6v6h-6z',
  zero: 'M4 9h16v11H4zM8 6a6 6 0 0 1 8 0M10 3.5a9 9 0 0 1 4 0M8 14h4',
  photo: 'M4 8h3l2-3h6l2 3h3v11H4zM15.5 13a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0',
  rotate: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7'
};

export function HaizenIcon({ name, className = 'h-[26px] w-[26px]' }: {
  name: keyof typeof paths; className?: string;
}) {
  return <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d={paths[name]} /></svg>;
}
