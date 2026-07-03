import { describe, expect, it } from 'vitest';

import { selfInspectionKioskButtonClass } from '../selfInspectionKioskTheme';

describe('selfInspectionKioskButtonClass', () => {
  it('actionCompact keeps text size while reducing height below default', () => {
    const actionCompact = selfInspectionKioskButtonClass({ size: 'actionCompact' });
    const defaultSize = selfInspectionKioskButtonClass({ size: 'default' });
    expect(actionCompact).toContain('min-h-6');
    expect(actionCompact).toContain('text-[15px]');
    expect(actionCompact).toContain('leading-none');
    expect(defaultSize).toContain('min-h-11');
    expect(actionCompact).not.toContain('min-h-11');
    expect(actionCompact).not.toContain('min-h-8');
  });

  it.each(['default', 'compact', 'icon', 'actionCompact'] as const)(
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

  it('enabled and disabled use kiosk secondary / disabled-opacity grammar', () => {
    const enabled = selfInspectionKioskButtonClass({ disabled: false });
    const disabled = selfInspectionKioskButtonClass({ disabled: true });
    expect(enabled).toContain('border-white/20');
    expect(enabled).toContain('bg-white/5');
    expect(disabled).toContain('opacity-40');
    expect(disabled).toContain('text-white/40');
  });

  it('inactive tone uses muted visual without disabled opacity tricks', () => {
    const inactive = selfInspectionKioskButtonClass({ tone: 'inactive' });
    expect(inactive).toContain('bg-white/5');
    expect(inactive).toContain('text-white/40');
    expect(inactive).not.toMatch(/opacity-60/);
    expect(inactive).not.toMatch(/grayscale/);
  });

  it('disabled takes precedence over inactive tone', () => {
    const disabledInactive = selfInspectionKioskButtonClass({ tone: 'inactive', disabled: true });
    expect(disabledInactive).toContain('cursor-not-allowed');
    expect(disabledInactive).not.toContain('hover:text-white/55');
  });

  it('highlighted uses emerald primary fill without ring or shadow', () => {
    const highlighted = selfInspectionKioskButtonClass({ highlighted: true });
    expect(highlighted).toContain('bg-emerald-500');
    expect(highlighted).not.toContain('ring-sky-400');
    expect(highlighted).not.toContain('shadow-');
  });

  it('highlighted is ignored when disabled', () => {
    const highlightedDisabled = selfInspectionKioskButtonClass({
      highlighted: true,
      disabled: true
    });
    expect(highlightedDisabled).not.toContain('bg-emerald-500');
    expect(highlightedDisabled).toContain('opacity-40');
  });

  it('wide keeps min width when disabled (no layout shift)', () => {
    expect(selfInspectionKioskButtonClass({ wide: true })).toContain('min-w-[11rem]');
    expect(selfInspectionKioskButtonClass({ wide: true, disabled: true })).toContain('min-w-[11rem]');
  });
});
