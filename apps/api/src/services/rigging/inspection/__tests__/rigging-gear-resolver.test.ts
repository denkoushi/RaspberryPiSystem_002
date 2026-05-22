import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RiggingGearResolver } from '../rigging-gear-resolver.js';

function createClient() {
  return {
    riggingGear: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

describe('RiggingGearResolver', () => {
  let client: ReturnType<typeof createClient>;
  let resolver: RiggingGearResolver;

  beforeEach(() => {
    client = createClient();
    resolver = new RiggingGearResolver(client as never);
  });

  it('prefers managementNumber lookup when control_num is present', async () => {
    const gear = { id: 'gear-1', managementNumber: 'RG-001', idNum: '82' };
    client.riggingGear.findUnique.mockResolvedValue(gear);

    const result = await resolver.resolve({ managementNumber: 'RG-001', idNum: '82' });

    expect(result).toEqual(gear);
    expect(client.riggingGear.findUnique).toHaveBeenCalledWith({ where: { managementNumber: 'RG-001' } });
    expect(client.riggingGear.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to idNum when managementNumber is empty', async () => {
    const gear = { id: 'gear-2', managementNumber: 'RG-082', idNum: '82' };
    client.riggingGear.findFirst.mockResolvedValue(gear);

    const result = await resolver.resolve({ managementNumber: '', idNum: '82' });

    expect(result).toEqual(gear);
    expect(client.riggingGear.findUnique).not.toHaveBeenCalled();
    expect(client.riggingGear.findFirst).toHaveBeenCalledWith({ where: { idNum: '82' } });
  });

  it('falls back to idNum when managementNumber does not match', async () => {
    const gear = { id: 'gear-3', managementNumber: 'RG-082', idNum: '82' };
    client.riggingGear.findUnique.mockResolvedValue(null);
    client.riggingGear.findFirst.mockResolvedValue(gear);

    const result = await resolver.resolve({ managementNumber: 'MISSING', idNum: '82' });

    expect(result).toEqual(gear);
  });

  it('returns null when both identifiers are missing', async () => {
    const result = await resolver.resolve({ managementNumber: '', idNum: '' });
    expect(result).toBeNull();
  });
});
