import { describe, expect, it } from 'vitest';

import {
  inspectionDrawingBoundedSelectClassName,
  inspectionDrawingBoundedSelectShellClassName,
  inspectionDrawingLibraryFilterResourceWidthClass,
  inspectionDrawingMetadataResourceFieldWidthClass
} from './inspectionDrawingKioskUi';

describe('inspectionDrawing bounded select layout tokens', () => {
  it('shell clips overflow so native select painting stays inside the field', () => {
    expect(inspectionDrawingBoundedSelectShellClassName).toContain('overflow-hidden');
    expect(inspectionDrawingBoundedSelectShellClassName).toContain('min-w-0');
    expect(inspectionDrawingBoundedSelectShellClassName).toContain('w-full');
  });

  it('select fills the shell without exceeding flex item width', () => {
    expect(inspectionDrawingBoundedSelectClassName).toContain('w-full');
    expect(inspectionDrawingBoundedSelectClassName).toContain('min-w-0');
    expect(inspectionDrawingBoundedSelectClassName).toContain('max-w-full');
  });

  it('library filter resource field keeps explicit max width on sm+', () => {
    expect(inspectionDrawingLibraryFilterResourceWidthClass).toContain('sm:max-w-[15rem]');
    expect(inspectionDrawingLibraryFilterResourceWidthClass).toContain('min-w-0');
  });

  it('create metadata resource field matches other metadata control width', () => {
    expect(inspectionDrawingMetadataResourceFieldWidthClass).toContain('w-[10.5rem]');
    expect(inspectionDrawingMetadataResourceFieldWidthClass).toContain('max-w-full');
    expect(inspectionDrawingMetadataResourceFieldWidthClass).toContain('min-w-0');
  });
});
