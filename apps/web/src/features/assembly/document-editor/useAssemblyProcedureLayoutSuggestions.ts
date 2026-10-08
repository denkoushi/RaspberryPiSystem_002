import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';

import { suggestAssemblyProcedureLayout } from '../../../api/client';

import type { AssemblyProcedureOverlayElement, ProcedureLayoutSuggestionResponse } from '@raspi-system/shared-types';

type LayoutSuggestionState =
  | { status: 'idle' }
  | { status: 'pending'; seconds: number }
  | { status: 'preview'; plans: ProcedureLayoutSuggestionResponse['plans']; planKey: 'standard' | 'largePhoto'; before: boolean }
  | { status: 'error'; message: string };

export function useAssemblyProcedureLayoutSuggestions(input: {
  documentId: string | null;
  pageIndex: number;
  elements: AssemblyProcedureOverlayElement[];
  accessPassword: string;
  holderToken: string | null;
  disabled: boolean;
  onStart: () => void;
  onApply: (elements: AssemblyProcedureOverlayElement[]) => void;
  onEditLeaseError: (error: unknown) => boolean;
}) {
  const [state, setState] = useState<LayoutSuggestionState>({ status: 'idle' });
  const request = useRef<AbortController | null>(null);
  const locked = state.status === 'pending' || state.status === 'preview';
  const canSuggest = !input.disabled && input.elements.filter(element => element.kind === 'TEXT' || element.kind === 'IMAGE').length >= 2;
  const cancel = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setState({ status: 'idle' });
  }, []);
  useEffect(() => {
    cancel();
    return () => { request.current?.abort(); request.current = null; };
  }, [input.documentId, cancel]);
  useEffect(() => { if (input.disabled) cancel(); }, [input.disabled, cancel]);
  useEffect(() => {
    if (state.status !== 'pending') return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setState(current => current.status === 'pending' ? { status: 'pending', seconds: Math.floor((Date.now() - startedAt) / 1000) } : current), 1000);
    return () => window.clearInterval(timer);
  }, [state.status]);

  const start = async () => {
    if (!canSuggest || locked || !input.documentId || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    input.onStart();
    setState({ status: 'pending', seconds: 0 });
    try {
      const response = await suggestAssemblyProcedureLayout({ id: input.documentId, pageIndex: input.pageIndex, elements: input.elements, accessPassword: input.accessPassword, holderToken: input.holderToken, signal: controller.signal });
      if (request.current !== controller || controller.signal.aborted) return;
      setState({ status: 'preview', plans: response.plans, planKey: 'standard', before: false });
    } catch (error) {
      if (request.current !== controller || controller.signal.aborted) return;
      input.onEditLeaseError(error);
      const code = isAxiosError(error) ? error.response?.data?.errorCode : undefined;
      setState({ status: 'error', message: code === 'ASSEMBLY_PROCEDURE_LAYOUT_DOES_NOT_FIT' ? 'このページは1枚に収まりません' : 'いまは提案できません' });
    } finally {
      if (request.current === controller) request.current = null;
    }
  };
  const proposal = state.status === 'preview' ? state.plans.find(plan => plan.key === state.planKey)!.elements : null;
  const apply = () => {
    if (input.disabled || !proposal) return;
    input.onApply(proposal);
    cancel();
  };
  return {
    state, locked, canSuggest, start, cancel, apply,
    previewElements: state.status === 'preview' && !state.before ? proposal : null,
    selectPlan: (planKey: 'standard' | 'largePhoto') => setState(current => current.status === 'preview' ? { ...current, planKey } : current),
    showBefore: (before: boolean) => setState(current => current.status === 'preview' ? { ...current, before } : current)
  };
}
