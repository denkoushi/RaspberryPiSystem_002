import { describe, expect, it } from 'vitest';

import { buildLoadBalancingRowEligibilityWhereSql } from '../load-balancing-eligibility.policy.js';

describe('buildLoadBalancingRowEligibilityWhereSql', () => {
  it('fkmail 必須・C/X 除外・実効未完了を含む', () => {
    const sql = buildLoadBalancingRowEligibilityWhereSql().sql.toLowerCase();

    expect(sql).toContain('"fkmail"."id" is not null');
    expect(sql).toContain('"ext"');
    expect(sql).toContain('"p"');
    expect(sql).toContain('statuscode');
    expect(sql).toContain(' in (');
    expect(sql).toContain('isexternallycompleted');
    expect(sql).toContain('iscompleted');
  });
});
