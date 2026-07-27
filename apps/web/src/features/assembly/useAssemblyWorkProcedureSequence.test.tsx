import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAssemblyWorkProcedureSequence } from './useAssemblyWorkProcedureSequence';

import type { AssemblyProcedureSequenceDto } from './types';

const { mockGetProcedureSequence } = vi.hoisted(() => ({
  mockGetProcedureSequence: vi.fn()
}));

vi.mock('../../api/client', () => ({
  getAssemblyWorkSessionProcedureSequence: (...args: unknown[]) =>
    mockGetProcedureSequence(...args)
}));

function sequence(machineName: string): AssemblyProcedureSequenceDto {
  return {
    mode: 'fallback',
    source: 'primary_fallback',
    reason: 'not_configured',
    machineName,
    machineNameKey: machineName,
    documents: [],
    stepSource: 'document_expansion',
    steps: [],
    fallbackProcedureDocument: null
  };
}

describe('useAssemblyWorkProcedureSequence', () => {
  beforeEach(() => {
    mockGetProcedureSequence.mockReset();
  });

  it('does not load procedure data before operator authorization', () => {
    const { result } = renderHook(() =>
      useAssemblyWorkProcedureSequence({ sessionId: 'session-1', enabled: false })
    );

    expect(result.current.state.status).toBe('idle');
    expect(mockGetProcedureSequence).not.toHaveBeenCalled();
  });

  it('ignores a stale response after the work session changes', async () => {
    let resolveFirst!: (value: AssemblyProcedureSequenceDto) => void;
    let resolveSecond!: (value: AssemblyProcedureSequenceDto) => void;
    mockGetProcedureSequence
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveSecond = resolve;
      }));

    const { result, rerender } = renderHook(
      ({ sessionId }) => useAssemblyWorkProcedureSequence({ sessionId, enabled: true }),
      { initialProps: { sessionId: 'session-1' } }
    );
    await waitFor(() => expect(mockGetProcedureSequence).toHaveBeenCalledWith('session-1'));

    rerender({ sessionId: 'session-2' });
    await waitFor(() => expect(mockGetProcedureSequence).toHaveBeenCalledWith('session-2'));
    act(() => resolveSecond(sequence('SECOND')));
    await waitFor(() => {
      expect(result.current.state.status).toBe('ready');
      if (result.current.state.status === 'ready') {
        expect(result.current.state.sequence.machineName).toBe('SECOND');
      }
    });

    act(() => resolveFirst(sequence('FIRST')));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe('ready');
    if (result.current.state.status === 'ready') {
      expect(result.current.state.sequence.machineName).toBe('SECOND');
    }
  });

  it('moves to loading immediately when retrying a failed request', async () => {
    mockGetProcedureSequence
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(sequence('RECOVERED'));
    const { result } = renderHook(() =>
      useAssemblyWorkProcedureSequence({ sessionId: 'session-1', enabled: true })
    );

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    act(() => result.current.retry());
    expect(result.current.state.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.state.status).toBe('ready');
      if (result.current.state.status === 'ready') {
        expect(result.current.state.sequence.machineName).toBe('RECOVERED');
      }
    });
    expect(mockGetProcedureSequence).toHaveBeenCalledTimes(2);
  });
});
