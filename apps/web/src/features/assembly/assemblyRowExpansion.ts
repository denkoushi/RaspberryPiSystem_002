import { useCallback, useState } from 'react';

export function toggleExpandedId(expandedIds: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(expandedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function useAssemblyRowExpansion(initialExpandedIds: Iterable<string> = []) {
  const [expandedIds, setExpandedIds] = useState(() => new Set(initialExpandedIds));

  const isExpanded = useCallback((id: string) => expandedIds.has(id), [expandedIds]);

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => toggleExpandedId(prev, id));
  }, []);

  return { expandedIds, isExpanded, toggle };
}
