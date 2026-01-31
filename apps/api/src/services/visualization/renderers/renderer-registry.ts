import type { Renderer } from './renderer.interface.js';

class RendererRegistry {
  private renderers: Map<string, Renderer> = new Map();

  register(renderer: Renderer): void {
    this.renderers.set(renderer.type, renderer);
  }

  get(type: string): Renderer | undefined {
    return this.renderers.get(type);
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.renderers.keys());
  }

  has(type: string): boolean {
    return this.renderers.has(type);
  }
}

let registryInstance: RendererRegistry | null = null;

export function getRendererRegistry(): RendererRegistry {
  if (!registryInstance) {
    registryInstance = new RendererRegistry();
  }
  return registryInstance;
}
