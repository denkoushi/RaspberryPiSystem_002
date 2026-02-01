import { getRendererRegistry } from './renderer-registry.js';
import type { Renderer } from './renderer.interface.js';

export class RendererFactory {
  static create(type: string): Renderer {
    const registry = getRendererRegistry();
    const renderer = registry.get(type);
    if (!renderer) {
      throw new Error(`Renderer not found: ${type}`);
    }
    return renderer;
  }

  static getRegisteredTypes(): string[] {
    const registry = getRendererRegistry();
    return registry.getRegisteredTypes();
  }
}
