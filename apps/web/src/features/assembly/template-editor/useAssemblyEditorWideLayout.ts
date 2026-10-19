import { useEffect, useState } from 'react';

/** この幅以上では設定パネルを浮遊表示し、狭い画面では紙面を覆わない列に置く。 */
export const ASSEMBLY_EDITOR_WIDE_MIN_WIDTH = 1280;

const isWide = () => typeof window !== 'undefined' && window.innerWidth >= ASSEMBLY_EDITOR_WIDE_MIN_WIDTH;

export function useAssemblyEditorWideLayout(): boolean {
  const [wide, setWide] = useState(isWide);
  useEffect(() => {
    const update = () => setWide(isWide());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return wide;
}
