import { describe, expect, it } from 'vitest';

import { validateWebCapturePath } from '../web-capture-path.js';

const BASE = 'http://web:8081';

describe('validateWebCapturePath', () => {
  it('accepts an admin page path and resolves it against the base URL', () => {
    expect(validateWebCapturePath('/admin/self-inspection/kpi?tab=today', BASE)).toEqual({
      ok: true,
      url: 'http://web:8081/admin/self-inspection/kpi?tab=today',
    });
  });

  it.each([
    ['', 'empty'],
    ['admin/kpi', 'relative without slash'],
    ['//evil.example/admin', 'protocol-relative'],
    ['https://evil.example/admin', 'absolute URL'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['/\\evil.example/admin', 'backslash host trick'],
    ['/admin\n/x', 'control character'],
    ['/api/signage/schedules', 'API path'],
    ['/admin/../api/users', 'dot segments resolving into the API'],
    [`/${'a'.repeat(600)}`, 'too long'],
  ])('rejects %j (%s)', (path) => {
    expect(validateWebCapturePath(path, BASE).ok).toBe(false);
  });
});
