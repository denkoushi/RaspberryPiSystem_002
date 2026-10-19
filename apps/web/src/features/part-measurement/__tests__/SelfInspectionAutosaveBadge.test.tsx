import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SelfInspectionAutosaveBadge } from '../SelfInspectionAutosaveBadge';

describe('SelfInspectionAutosaveBadge', () => {
  it('renders no badge while idle', () => {
    render(<SelfInspectionAutosaveBadge status="idle" />);
    expect(screen.queryByTestId('self-inspection-autosave-badge')).not.toBeInTheDocument();
  });

  it.each([
    ['pending', null, '下書き 保存中…'],
    ['saved', '12:34:56', '下書き 自動保存済 12:34:56'],
    ['unsynced', null, '下書き 未同期']
  ] as const)('renders %s status', (status, savedAtLabel, label) => {
    render(<SelfInspectionAutosaveBadge status={status} savedAtLabel={savedAtLabel} />);
    expect(screen.getByTestId('self-inspection-autosave-badge')).toHaveTextContent(label);
  });
});
