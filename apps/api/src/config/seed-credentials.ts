export type SeedEnvironment = Record<string, string | undefined>;

export interface SeedCredentialPolicy {
  username: string;
  password: string;
  externallySupplied: boolean;
  seedSyntheticClientDevices: boolean;
}

const requirePair = (
  environment: SeedEnvironment,
  usernameName: string,
  passwordName: string
): { username: string; password: string } | null => {
  const username = environment[usernameName]?.trim() ?? '';
  const password = environment[passwordName] ?? '';
  if ((username.length > 0) !== (password.length > 0)) {
    throw new Error(`${usernameName} and ${passwordName} must be provided together`);
  }
  return username.length > 0 ? { username, password } : null;
};

const assertProductionPassword = (password: string): void => {
  if (password === 'admin1234' || password.length < 16) {
    throw new Error('SEED_ADMIN_PASSWORD must be an explicit strong production value');
  }
};

export const resolveSeedCredentialPolicy = (
  environment: SeedEnvironment = process.env
): SeedCredentialPolicy => {
  const e2e = requirePair(environment, 'E2E_ADMIN_USERNAME', 'E2E_ADMIN_PASSWORD');
  const configured = requirePair(environment, 'SEED_ADMIN_USERNAME', 'SEED_ADMIN_PASSWORD');
  const isProduction = environment.NODE_ENV === 'production';

  if (isProduction) {
    if (e2e) {
      throw new Error('E2E administrator credentials are not accepted in production');
    }
    if (!configured) {
      throw new Error('SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD are required in production');
    }
    assertProductionPassword(configured.password);
    return {
      ...configured,
      externallySupplied: true,
      seedSyntheticClientDevices: false,
    };
  }

  const selected = e2e ?? configured;
  return {
    username: selected?.username ?? 'admin',
    password: selected?.password ?? 'admin1234',
    externallySupplied: selected !== null,
    seedSyntheticClientDevices: true,
  };
};
