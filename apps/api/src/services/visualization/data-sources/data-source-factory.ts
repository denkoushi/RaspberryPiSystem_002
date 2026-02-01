import { getDataSourceRegistry } from './data-source-registry.js';
import type { DataSource } from './data-source.interface.js';

export class DataSourceFactory {
  static create(type: string): DataSource {
    const registry = getDataSourceRegistry();
    const source = registry.get(type);
    if (!source) {
      throw new Error(`Data source not found: ${type}`);
    }
    return source;
  }

  static getRegisteredTypes(): string[] {
    const registry = getDataSourceRegistry();
    return registry.getRegisteredTypes();
  }
}
