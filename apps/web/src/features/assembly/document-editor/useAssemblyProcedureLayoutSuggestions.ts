import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';

import { suggestAssemblyProcedureLayout } from '../../../api/client';

import type { AssemblyProcedureOverlayElement, ProcedureLayoutSuggestionResponse } from '@raspi-system/shared-types';

type LayoutSuggestionState =
  | { status: 'idle' }
  | { status: 'pending'; seconds: number }
  | { status: 'preview'; suggestion: ProcedureLayoutSuggestionResponse; before: boolean }
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
  const [appliedCaptionElementIds, setAppliedCaptionElementIds] = useState<string[]>([]);
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
    setAppliedCaptionElementIds([]);
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
      setState({ status: 'preview', suggestion: response, before: false });
    } catch (error) {
      if (request.current !== controller || controller.signal.aborted) return;
      input.onEditLeaseError(error);
      const code = isAxiosError(error) ? error.response?.data?.errorCode : undefined;
      setState({ status: 'error', message: code === 'ASSEMBLY_PROCEDURE_LAYOUT_DOES_NOT_FIT' ? 'このページは1枚に収まりません' : 'いまは提案できません' });
    } finally {
      if (request.current === controller) request.current = null;
    }
  };
  const proposal = state.status === 'preview' ? state.suggestion.elements : null;
  const apply = () => {
    if (input.disabled || !proposal) return;
    if (state.status === 'preview') {
      setAppliedCaptionElementIds(current => [...new Set([...current, ...state.suggestion.addedElementIds])]);
    }
    input.onApply(proposal);
    cancel();
  };
  return {
    appliedCaptionElementIds, state, locked, canSuggest, start, cancel, apply,
    // Preview-only mask: the proposal passed to onApply remains ordinary text.
    previewElements: state.status === 'preview' && !state.before ? proposal?.map(element =>
      element.kind === 'TEXT' && state.suggestion.addedElementIds.includes(element.id)
        ? { ...element, mask: { enabled: true, color: '#fff2c6' } } : element) ?? null : null,
    showBefore: (before: boolean) => setState(current => current.status === 'preview' ? { ...current, before } : current)
  };
}
