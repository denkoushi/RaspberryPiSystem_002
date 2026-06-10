import { describe, expect, it } from 'vitest';

import { groupParticipantEmployeeNamesBySessionId } from '../self-inspection-participant-names.query.js';

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
