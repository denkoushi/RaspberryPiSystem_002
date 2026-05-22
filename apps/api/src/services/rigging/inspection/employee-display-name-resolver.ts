import { EmployeeStatus, type Employee, type PrismaClient } from '@prisma/client';

import { compactEmployeeDisplayName } from '../../employee/compact-employee-display-name.js';

export class EmployeeDisplayNameResolver {
  private cache: Map<string, Employee | null> | null = null;

  constructor(private readonly client: PrismaClient) {}

  async findByDisplayName(displayName: string): Promise<Employee | null> {
    const normalized = compactEmployeeDisplayName(displayName);
    if (!normalized) {
      return null;
    }
    const map = await this.loadCache();
    return map.get(normalized) ?? null;
  }

  private async loadCache(): Promise<Map<string, Employee | null>> {
    if (this.cache) {
      return this.cache;
    }

    const employees = await this.client.employee.findMany({
      where: { status: EmployeeStatus.ACTIVE },
    });
    const map = new Map<string, Employee | null>();
    for (const employee of employees) {
      const key = compactEmployeeDisplayName(employee.displayName);
      if (!key) {
        continue;
      }
      if (!map.has(key)) {
        map.set(key, employee);
      }
    }
    this.cache = map;
    return map;
  }
}
