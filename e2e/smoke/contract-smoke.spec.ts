import { test, expect } from '@playwright/test';

test.describe('契約整合性: loans active', () => {
  test('active loans endpoint returns loans array (shape contract)', async ({ request }) => {
    const res = await request.get('/api/tools/loans/active', {
      headers: { 'x-client-key': 'client-key-raspberrypi4-kiosk1' }
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('loans');
    expect(Array.isArray(body.loans)).toBe(true);

    if (body.loans.length > 0) {
      const loan = body.loans[0];
      expect(loan).toHaveProperty('id');
      expect(loan).toHaveProperty('borrowedAt');
      expect(loan).toHaveProperty('employee');
    }
  });
});


















