import { describe, expect, it } from 'vitest';

import { latestStatusByBolt } from './assemblyTemplateDraft';
import { resolveAssemblyWorkActionPresentation } from './assemblyWorkActionPresentation';

import type { AssemblyWorkSessionDto } from './types';

describe('assembly work UI semantics', () => {
  it('does not let IGNORED replace the latest valid marker result or current target', () => {
    const status = latestStatusByBolt({
      currentBoltId: 'bolt-1',
      torqueRecords: [
        { templateBoltId: 'bolt-1', judgement: 'ok', accepted: true },
        { templateBoltId: 'bolt-1', judgement: 'ignored', accepted: false },
        { templateBoltId: 'bolt-2', judgement: 'ng', accepted: false }
      ]
    } as AssemblyWorkSessionDto);

    expect(status.get('bolt-1')).toBe('ok');
    expect(status.get('bolt-2')).toBe('ng');
  });

  it('highlights only the immediate enabled action and leaves redo neutral', () => {
    const base = {
      sessionActive: true,
      busy: false,
      hasCurrentBolt: true,
      hasCurrentArea: true,
      allBoltsComplete: false,
      canComplete: false,
      torqueValueValid: true,
      selectedProfileId: '',
      hasConfirmation: false,
      leaseOwned: false,
      ownedByOther: false
    };
    const manual = resolveAssemblyWorkActionPresentation(base);
    expect(manual.recordTorque).toEqual({ disabled: false, highlighted: true });
    expect(manual.restartArea).toEqual({ disabled: false, highlighted: false });
    expect(Object.values(manual).filter((value) => value.highlighted)).toHaveLength(1);

    const completion = resolveAssemblyWorkActionPresentation({
      ...base,
      hasCurrentBolt: false,
      allBoltsComplete: true,
      canComplete: true,
      torqueValueValid: false
    });
    expect(completion.complete).toEqual({ disabled: false, highlighted: true });
    expect(Object.values(completion).filter((value) => value.highlighted)).toHaveLength(1);

    const inactive = resolveAssemblyWorkActionPresentation({
      ...base,
      sessionActive: false
    });
    expect(Object.values(inactive).every((value) => value.disabled)).toBe(true);
    expect(Object.values(inactive).some((value) => value.highlighted)).toBe(false);
  });
});
