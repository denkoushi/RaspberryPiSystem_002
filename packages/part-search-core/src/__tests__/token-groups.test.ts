import { describe, expect, it } from 'vitest';

import { buildTokenGroupsForSearch } from '../token-groups.js';

describe('buildTokenGroupsForSearch', () => {
  it('splits whitespace into AND token groups', () => {
    const r = buildTokenGroupsForSearch('テーブル 脚');
    expect(r.tokenGroups.length).toBe(2);
    expect(r.tokenGroups[0]).toContain('テーブル');
    expect(r.tokenGroups[1].sort()).toEqual(['アシ', '脚', '足'].sort());
  });

  it('single token without spaces stays one group', () => {
    const r = buildTokenGroupsForSearch('テーブル脚');
    expect(r.tokenGroups.length).toBe(1);
    expect(r.tokenGroups[0]).toContain('テーブル脚');
  });
});
