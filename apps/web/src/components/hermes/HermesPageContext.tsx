import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { HermesPageContext } from '../../api/domains/assembly';

type PageContextState = {
  pageContext: HermesPageContext | null;
  setPageContext: (value: HermesPageContext) => void;
  clearPageContext: () => void;
};

const Context = createContext<PageContextState>({
  pageContext: null,
  setPageContext: () => undefined,
  clearPageContext: () => undefined
});

export function HermesPageContextProvider({ children }: { children: ReactNode }) {
  const [pageContext, setPageContext] = useState<HermesPageContext | null>(null);
  const clearPageContext = useCallback(() => setPageContext(null), []);
  const value = useMemo(() => ({ pageContext, setPageContext, clearPageContext }), [pageContext, clearPageContext]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useHermesPageContext() {
  return useContext(Context);
}
