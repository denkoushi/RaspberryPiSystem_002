import { useEffect } from 'react';

export function usePlanningBoardChainPartChange(fseiban: string | null, onChange?: (fseiban: string | null) => void) {
  useEffect(() => { onChange?.(fseiban); }, [fseiban, onChange]);
  useEffect(() => () => { onChange?.(null); }, [onChange]);
}

export function usePlanningBoardChainVisibility(show: boolean, setPart: (key: string | null) => void, setItem: (id: string | null) => void) {
  useEffect(() => { if (!show) { setPart(null); setItem(null); } }, [show, setPart, setItem]);
}
