import { useCallback, useMemo, useState } from 'react';

import { operationGuides, type OperationGuide } from './definitions';
import { isOperationGuideQuestion } from './questionMatcher';

export function useOperationGuide() {
  const [question, setQuestion] = useState<string | null>(null);
  const [guide, setGuide] = useState<OperationGuide | null>(null);
  const [index, setIndex] = useState(0);
  const clear = useCallback(() => { setQuestion(null); setGuide(null); setIndex(0); }, []);
  const receive = useCallback((content: string) => {
    if (!isOperationGuideQuestion(content)) return false;
    setQuestion(content); setGuide(null); setIndex(0);
    return true;
  }, []);
  const choose = useCallback((id: OperationGuide['id']) => {
    setGuide(operationGuides.find(item => item.id === id) ?? null);
    setIndex(0);
  }, []);
  const stepCount = guide?.steps.length ?? 0;
  const next = useCallback(() => setIndex(current => Math.min(current + 1, stepCount)), [stepCount]);
  const back = useCallback(() => setIndex(current => Math.max(0, current - 1)), []);
  return useMemo(() => ({ question, guide, index, receive, choose, next, back, clear }),
    [question, guide, index, receive, choose, next, back, clear]);
}
