import { describe, expect, it } from 'vitest';

import { resolveSeedCredentialPolicy } from './seed-credentials.js';

describe('resolveSeedCredentialPolicy', () => {
  it('keeps deterministic fixtures outside production', () => {
    expect(resolveSeedCredentialPolicy({ NODE_ENV: 'test' })).toEqual({
      username: 'admin',
      password: 'admin1234',
      externallySupplied: false,
      seedSyntheticClientDevices: true,
    });
  });

  it('accepts externally supplied E2E credentials only outside production', () => {
    expect(
      resolveSeedCredentialPolicy({
        NODE_ENV: 'test',
        E2E_ADMIN_USERNAME: 'ci-admin',
        E2E_ADMIN_PASSWORD: 'ci-generated-password',
      })
    ).toMatchObject({
      username: 'ci-admin',
      externallySupplied: true,
      seedSyntheticClientDevices: true,
    });
  });

  it('fails closed when production credentials are absent or known weak', () => {
    expect(() => resolveSeedCredentialPolicy({ NODE_ENV: 'production' })).toThrow(
      'SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD are required in production'
    );
    expect(() =>
      resolveSeedCredentialPolicy({
        NODE_ENV: 'production',
        SEED_ADMIN_USERNAME: 'admin',
        SEED_ADMIN_PASSWORD: 'admin1234',
      })
    ).toThrow('explicit strong production value');
  });

  it('accepts explicit strong production credentials and disables synthetic clients', () => {
    expect(
      resolveSeedCredentialPolicy({
        NODE_ENV: 'production',
        SEED_ADMIN_USERNAME: 'bootstrap-admin',
        SEED_ADMIN_PASSWORD: 'a-unique-production-secret-value',
      })
    ).toMatchObject({
      username: 'bootstrap-admin',
      externallySupplied: true,
      seedSyntheticClientDevices: false,
    });
  });

  it('rejects incomplete pairs and E2E credentials in production', () => {
    expect(() =>
      resolveSeedCredentialPolicy({ NODE_ENV: 'test', E2E_ADMIN_USERNAME: 'ci-admin' })
    ).toThrow('must be provided together');
    expect(() =>
      resolveSeedCredentialPolicy({
        NODE_ENV: 'production',
        E2E_ADMIN_USERNAME: 'ci-admin',
        E2E_ADMIN_PASSWORD: 'ci-generated-password',
        SEED_ADMIN_USERNAME: 'bootstrap-admin',
        SEED_ADMIN_PASSWORD: 'a-unique-production-secret-value',
      })
    ).toThrow('not accepted in production');
  });
});
