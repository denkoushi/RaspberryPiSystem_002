import { EmployeeStatus, type Employee } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindMany = vi.fn();

vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  return {
    ...actual,
    EmployeeStatus: actual.EmployeeStatus,
  };
});

import { EmployeeDisplayNameResolver } from '../employee-display-name-resolver.js';

describe('EmployeeDisplayNameResolver', () => {
  const client = {
    employee: { findMany: mockFindMany },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches CSV name without spaces to master displayName with spaces', async () => {
    const employee = {
      id: 'emp-yada',
      displayName: '矢田 彗遥',
      status: EmployeeStatus.ACTIVE,
    } as Employee;
    mockFindMany.mockResolvedValue([employee]);

    const resolver = new EmployeeDisplayNameResolver(client as never);
    const result = await resolver.findByDisplayName('矢田彗遥');

    expect(result).toEqual(employee);
  });

  it('matches names with full-width spaces', async () => {
    const employee = {
      id: 'emp-ishii',
      displayName: '石井 和也',
      status: EmployeeStatus.ACTIVE,
    } as Employee;
    mockFindMany.mockResolvedValue([employee]);

    const resolver = new EmployeeDisplayNameResolver(client as never);
    const result = await resolver.findByDisplayName('石井\u3000和也');

    expect(result).toEqual(employee);
  });

  it('returns null for unknown display name', async () => {
    mockFindMany.mockResolvedValue([]);

    const resolver = new EmployeeDisplayNameResolver(client as never);
    const result = await resolver.findByDisplayName('存在しない名前');

    expect(result).toBeNull();
  });

  it('uses first employee when compact keys collide', async () => {
    const first = {
      id: 'emp-first',
      displayName: '山田 太郎',
      status: EmployeeStatus.ACTIVE,
    } as Employee;
    const second = {
      id: 'emp-second',
      displayName: '山田太郎',
      status: EmployeeStatus.ACTIVE,
    } as Employee;
    mockFindMany.mockResolvedValue([first, second]);

    const resolver = new EmployeeDisplayNameResolver(client as never);
    const result = await resolver.findByDisplayName('山田太郎');

    expect(result?.id).toBe('emp-first');
  });
});
