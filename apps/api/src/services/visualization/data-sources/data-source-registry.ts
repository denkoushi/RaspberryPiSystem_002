import type { DataSource } from './data-source.interface.js';

class DataSourceRegistry {
  private sources: Map<string, DataSource> = new Map();

  register(source: DataSource): void {
    this.sources.set(source.type, source);
  }

  get(type: string): DataSource | undefined {
    return this.sources.get(type);
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.sources.keys());
  }

  has(type: string): boolean {
    return this.sources.has(type);
  }
}

let registryInstance: DataSourceRegistry | null = null;

export function getDataSourceRegistry(): DataSourceRegistry {
  if (!registryInstance) {
    registryInstance = new DataSourceRegistry();
  }
  return registryInstance;
}
