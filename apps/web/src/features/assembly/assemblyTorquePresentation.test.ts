import { describe, expect, it } from 'vitest';

import {
  assemblyTorqueCurrentFeedback,
  assemblyTorqueMarkerStates,
  newestAssemblyTorqueRecords
} from './assemblyTorquePresentation';

import type { AssemblyTorqueRecordDto } from './types';

function record(overrides: Partial<AssemblyTorqueRecordDto> = {}): AssemblyTorqueRecordDto {
  return {
    id: 'record-a',
    sessionId: 'session-1',
    templateBoltId: 'bolt-1',
    attempt: 1,
    inputSource: 'manual',
    value: '90',
    inputUnit: 'kgf-cm',
    valueNm: null,
    judgement: 'ok',
    accepted: true,
    ignoredReason: null,
    recordedAt: '2026-07-18T00:00:00.000Z',
    createdAt: '2026-07-18T00:00:00.000Z',
    tighteningId: 'BOLT-1',
    markerNo: 1,
    areaId: 'area-1',
    areaName: 'ストッパー取付',
    ...overrides
  };
}

describe('assembly torque presentation', () => {
  it('uses waiting for an untouched current marker and pending for other untouched markers', () => {
    const states = assemblyTorqueMarkerStates({ currentBoltId: 'bolt-1', torqueRecords: [] });

    expect(states.get('bolt-1')).toBe('waiting');
    expect(states.get('bolt-2') ?? 'pending').toBe('pending');
  });

  it('preserves current NG retry instead of replacing it with waiting', () => {
    const states = assemblyTorqueMarkerStates({
      currentBoltId: 'bolt-1',
      torqueRecords: [record({ judgement: 'ng', accepted: true, value: '78' })]
    });

    expect(states.get('bolt-1')).toBe('retry');
    expect(assemblyTorqueCurrentFeedback({
      currentBoltId: 'bolt-1',
      torqueRecords: [record({ judgement: 'ng', accepted: true, value: '78' })]
    })).toMatchObject({ kind: 'ng', message: expect.stringContaining('78 kgf-cm') });
  });

  it('distinguishes an unaccepted agent input from a torque NG', () => {
    const ignored = record({
      inputSource: 'agent',
      judgement: 'ignored',
      accepted: false,
      ignoredReason: '校正期限切れ'
    });
    const states = assemblyTorqueMarkerStates({ currentBoltId: 'bolt-1', torqueRecords: [ignored] });

    expect(states.get('bolt-1')).toBe('unaccepted');
    expect(assemblyTorqueCurrentFeedback({ currentBoltId: 'bolt-1', torqueRecords: [ignored] })).toMatchObject({
      kind: 'unaccepted',
      message: expect.stringContaining('校正期限切れ')
    });
  });

  it('uses the newest recorded timestamp rather than API response order', () => {
    const olderNg = record({ id: 'record-ng', judgement: 'ng', accepted: true, recordedAt: '2026-07-18T00:00:00.000Z' });
    const newerOk = record({ id: 'record-ok', judgement: 'ok', accepted: true, recordedAt: '2026-07-18T00:01:00.000Z' });

    const states = assemblyTorqueMarkerStates({ currentBoltId: null, torqueRecords: [newerOk, olderNg] });
    expect(states.get('bolt-1')).toBe('complete');
    expect(newestAssemblyTorqueRecords([olderNg, newerOk]).map((item) => item.id)).toEqual(['record-ok', 'record-ng']);
  });

  it('breaks same-time ties by ID so the result is stable', () => {
    const retry = record({ id: 'record-a', judgement: 'ng', accepted: true });
    const complete = record({ id: 'record-b', judgement: 'ok', accepted: true });

    const firstOrder = assemblyTorqueMarkerStates({ currentBoltId: null, torqueRecords: [retry, complete] });
    const reverseOrder = assemblyTorqueMarkerStates({ currentBoltId: null, torqueRecords: [complete, retry] });

    expect(firstOrder.get('bolt-1')).toBe('complete');
    expect(reverseOrder.get('bolt-1')).toBe('complete');
  });
});
