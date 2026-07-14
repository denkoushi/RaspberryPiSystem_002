import { describe, expect, it } from 'vitest';

import {
  groupParticipantEmployeeNamesBySessionId,
  groupParticipantSummariesBySessionId
} from '../self-inspection-participant-names.query.js';

describe('groupParticipantEmployeeNamesBySessionId', () => {
  it('groups ordered names per session', () => {
    const map = groupParticipantEmployeeNamesBySessionId([
      { session_id: 's1', name: '山田' },
      { session_id: 's1', name: '佐藤' },
      { session_id: 's2', name: '鈴木' }
    ]);
    expect(map.get('s1')).toEqual(['山田', '佐藤']);
    expect(map.get('s2')).toEqual(['鈴木']);
  });

  it('returns empty map for no rows', () => {
    expect(groupParticipantEmployeeNamesBySessionId([]).size).toBe(0);
  });
});

describe('groupParticipantSummariesBySessionId', () => {
  it('keeps compatible names and distinct employee identities in query order', () => {
    const map = groupParticipantSummariesBySessionId([
      { session_id: 's1', kind: 'name', employee_id: null, name: '山田' },
      { session_id: 's1', kind: 'employee', employee_id: 'e1', name: '山田' },
      { session_id: 's1', kind: 'employee', employee_id: 'e2', name: '山田' },
      { session_id: 's2', kind: 'name', employee_id: null, name: '佐藤' }
    ]);

    expect(map.get('s1')).toEqual({
      participantEmployeeNames: ['山田'],
      participantEmployees: [
        { employeeId: 'e1', displayName: '山田' },
        { employeeId: 'e2', displayName: '山田' }
      ]
    });
    expect(map.get('s2')).toEqual({
      participantEmployeeNames: ['佐藤'],
      participantEmployees: []
    });
  });

  it('returns empty map for no rows', () => {
    expect(groupParticipantSummariesBySessionId([]).size).toBe(0);
  });
});
