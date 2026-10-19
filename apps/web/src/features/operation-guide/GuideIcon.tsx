type IconName = 'guide' | 'assembly' | 'back' | 'next' | 'close' | 'chat' | 'check';
const paths: Record<IconName, string> = {
  guide: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm4 5-3 5-5 3 3-5 5-3Z',
  assembly: 'm12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
  back: 'm15 5-7 7 7 7', next: 'm9 5 7 7-7 7', close: 'm6 6 12 12M18 6 6 18',
  chat: 'M21 11a8 8 0 0 1-8 8H8l-5 3v-7a8 8 0 0 1 0-8 8 8 0 0 1 18 4Z',
  check: 'm5 12 4 4L19 6',
};
export function GuideIcon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
