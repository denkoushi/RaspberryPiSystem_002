import { useEffect, useState } from 'react';

/** この幅以上（現場の 1920×1080 キオスク）では、右の列を常に出して締付条件を並べる。 */
export const ASSEMBLY_EDITOR_WIDE_MIN_WIDTH = 1536;

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
