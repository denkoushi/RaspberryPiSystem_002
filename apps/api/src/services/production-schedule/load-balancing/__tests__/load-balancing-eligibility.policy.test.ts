import { describe, expect, it } from 'vitest';

import { FKOJUNST_MAIL_COMPLETED_STATUS_CODES } from '../../completion/fkojunst-mail-status-completion.policy.js';
import { buildLoadBalancingRowEligibilityWhereSql } from '../load-balancing-eligibility.policy.js';

describe('buildLoadBalancingRowEligibilityWhereSql', () => {
  it('fkmail 必須・C/X 除外・実効未完了を含む', () => {
    const sql = buildLoadBalancingRowEligibilityWhereSql().sql.toLowerCase();

    expect(sql).toContain('"fkmail"."id" is not null');
    expect(sql).toContain('"ext"');
    expect(sql).toContain('"p"');
    expect(sql).toContain('statuscode');
    expect(sql).toContain(' not ');
    expect(sql).toContain('statuscode');
    expect(sql).toContain('in (?, ?)');
    expect(FKOJUNST_MAIL_COMPLETED_STATUS_CODES).toEqual(['C', 'X']);
    expect(sql).toContain('isexternallycompleted');
    expect(sql).toContain('iscompleted');
    expect(sql).toContain('= false');
  });
});
