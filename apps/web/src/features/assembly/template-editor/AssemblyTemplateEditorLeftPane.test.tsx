import { act, cleanup, render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssemblyTemplateEditorLeftPane } from './AssemblyTemplateEditorLeftPane';

const mocks = vi.hoisted(() => ({ retained: new Set<string>() }));
vi.mock('../../../hooks/useProtectedImageBlobUrl', () => ({
  useProtectedImageBlobUrl: (path: string) => {
    useEffect(() => {
      mocks.retained.add(path);
      return () => { mocks.retained.delete(path); };
    }, [path]);
    return { blobUrl: path };
  }
}));
vi.mock('./AssemblyTemplateEditorHeader', () => ({ AssemblyTemplateEditorHeader: () => null }));
vi.mock('../AssemblyTemplateProcedurePane', () => ({ AssemblyTemplateProcedurePane: () => null }));
vi.mock('../AssemblyProcedureStoryboard', () => ({ AssemblyProcedureStoryboard: () => null }));
vi.mock('../../kiosk-sop', () => ({ KioskSopLauncher: () => null }));
vi.mock('./AssemblyTemplateEditorContext', () => ({
  useAssemblyTemplateEditorNavigation: () => ({ renderLink: () => null }),
  useAssemblyTemplateEditor: () => ({
    areas: [], procedureSteps: [], visibleCheckItems: [], templateName: '',
    leftPaneTab: 'areas', pageOptions: Array.from({ length: 60 }, (_, index) => ({
      key: `page-${index}`, label: `${index + 1}ページ`, pageIndex: index,
      imageRelativePath: `/page-${index}.png`
    }))
  })
}));

describe('template editor page thumbnail lifetime', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); mocks.retained.clear(); });

  it('releases images outside the scroll window after visiting every page and reloads on return', () => {
    const observers: Array<{ notify: (visible: boolean) => void; disconnect: ReturnType<typeof vi.fn> }> = [];
    const options: IntersectionObserverInit[] = [];
    vi.stubGlobal('IntersectionObserver', class {
      disconnect = vi.fn();
      constructor(callback: IntersectionObserverCallback, config: IntersectionObserverInit) {
        options.push(config);
        observers.push({
          notify: (visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver),
          disconnect: this.disconnect
        });
      }
      observe() {}
    });
    const { unmount } = render(<AssemblyTemplateEditorLeftPane />);
    const left = screen.getByTestId('assembly-template-editor-left-pane');
    expect(observers).toHaveLength(60);
    expect(options.every((option) => option.root === left && option.rootMargin === '200px')).toBe(true);
    expect(mocks.retained.size).toBe(0);
    for (let index = 0; index < 60; index += 6) {
      act(() => observers.forEach((observer, pageIndex) => observer.notify(pageIndex >= index && pageIndex < index + 6)));
      expect(mocks.retained.size).toBe(6);
      expect(left.querySelectorAll('img')).toHaveLength(6);
    }
    expect(within(left).getByRole('button', { name: '1ページ', exact: true }).querySelector('img')).toBeNull();
    expect(observers.every((observer) => observer.disconnect.mock.calls.length === 0)).toBe(true);
    act(() => observers.forEach((observer, index) => observer.notify(index === 0)));
    expect(mocks.retained).toEqual(new Set(['/page-0.png']));
    unmount();
    expect(mocks.retained.size).toBe(0);
    expect(observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true);
  });
});
