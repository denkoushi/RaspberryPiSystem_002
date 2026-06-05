import { describe, expect, it } from 'vitest';

import { selfInspectionKioskButtonClass } from '../selfInspectionKioskTheme';

describe('selfInspectionKioskButtonClass', () => {
  it.each(['default', 'compact', 'icon'] as const)(
    'size %s does not use opacity-60 or grayscale for enabled/disabled',
    (size) => {
      const enabled = selfInspectionKioskButtonClass({ disabled: false, size });
      const disabled = selfInspectionKioskButtonClass({ disabled: true, size });
      for (const cls of [enabled, disabled]) {
        expect(cls).not.toMatch(/opacity-60/);
        expect(cls).not.toMatch(/grayscale/);
        expect(cls).not.toMatch(/saturate/);
      }
    }
  );

  it('enabled and disabled use borderless base styles', () => {
    const enabled = selfInspectionKioskButtonClass({ disabled: false });
    const disabled = selfInspectionKioskButtonClass({ disabled: true });
    expect(enabled).toContain('border-0');
    expect(enabled).toContain('bg-slate-700');
    expect(disabled).toContain('border-0');
    expect(disabled).toContain('text-white/40');
  });

  it('highlighted uses ring and shadow without changing border width', () => {
    const highlighted = selfInspectionKioskButtonClass({ highlighted: true });
    expect(highlighted).toContain('ring-sky-400');
    expect(highlighted).toContain('shadow-');
    expect(highlighted).toContain('border-0');
    expect(highlighted).not.toContain('border-2');
  });

  it('highlighted is ignored when disabled', () => {
    const highlightedDisabled = selfInspectionKioskButtonClass({
      highlighted: true,
      disabled: true
    });
    expect(highlightedDisabled).not.toContain('ring-sky-400');
    expect(highlightedDisabled).toContain('border-0');
  });

  it('wide keeps min width when disabled (no layout shift)', () => {
    expect(selfInspectionKioskButtonClass({ wide: true })).toContain('min-w-[11rem]');
    expect(selfInspectionKioskButtonClass({ wide: true, disabled: true })).toContain('min-w-[11rem]');
  });
});
