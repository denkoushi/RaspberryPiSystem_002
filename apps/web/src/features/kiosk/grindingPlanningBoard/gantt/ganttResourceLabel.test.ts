import { describe, expect, it } from 'vitest';

import { ganttResourceLabel } from './ganttResourceLabel';

describe('ganttResourceLabel', () => {
  it('shows the resource CD once when the machine name already starts with it', () => {
    expect(ganttResourceLabel('584', ['584 PSG63'])).toBe('584 PSG63');
    expect(ganttResourceLabel('584', ['５８４　ｐｓｇ６３'])).toBe('584 PSG63');
    expect(ganttResourceLabel('588', ['588 GHL-B512', '588 GHL-B513'])).toBe('588 GHL-B512・GHL-B513');
  });

  it('puts the resource CD in front of a name that does not contain it', () => {
    expect(ganttResourceLabel('584', ['PSG63'])).toBe('584 PSG63');
    expect(ganttResourceLabel('584', ['584'])).toBe('584');
    expect(ganttResourceLabel('584', undefined)).toBe('584');
  });
});
