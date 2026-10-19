import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyBoltConditionStrip } from './AssemblyBoltConditionStrip';

const mockListTorqueTrainingPrograms = vi.fn();

vi.mock('../../api/client', () => ({
  listTorqueTrainingPrograms: (...args: unknown[]) => mockListTorqueTrainingPrograms(...args)
}));

const version = {
  version: 1,
  nominalDiameter: 'M8',
  boltLengthMm: '25',
  material: 'SCM435',
  strengthClass: '12.9',
  capabilityGroupId: 'group-1',
  nominalTorque: '35.5',
  lowerLimit: '32',
  upperLimit: '39.1',
  unit: 'N·m'
};

describe('AssemblyBoltConditionStrip', () => {
  beforeEach(() => {
    mockListTorqueTrainingPrograms.mockReset();
    mockListTorqueTrainingPrograms.mockResolvedValue([
      { id: 'p1', code: 'P1', isActive: true, currentVersion: 1, versions: [version] },
      { id: 'p2', code: 'P2', isActive: true, currentVersion: 1, versions: [{ ...version, nominalDiameter: 'M6', boltLengthMm: '16' }] }
    ]);
  });

  it('adds a condition from the training menu with one tap and hides ones already listed', async () => {
    const onAdd = vi.fn();
    render(
      <AssemblyBoltConditionStrip
        entries={[
          {
            key: 'M8|25|SCM435|12.9|group-1|32|35.5|39.1|N·m',
            condition: { ...version, boltLengthMm: 25, nominalTorque: 35.5, lowerLimit: 32, upperLimit: 39.1 },
            markerNos: [1, 2]
          }
        ]}
        activeKey={null}
        selectedMarkerNo={null}
        readOnly={false}
        onSelect={vi.fn()}
        onAdd={onAdd}
      />
    );

    expect(screen.getByRole('button', { name: 'M8×25 SCM435 12.9 で置く' })).toHaveTextContent('2か所');
    expect(mockListTorqueTrainingPrograms).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '＋条件' }));
    const list = await screen.findByRole('list', { name: '訓練メニューの締付条件' });
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(within(list).getByRole('button', { name: /M6×16/ }));

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ nominalDiameter: 'M6', boltLengthMm: 16, nominalTorque: 35.5 }));
    expect(screen.queryByRole('list', { name: '訓練メニューの締付条件' })).not.toBeInTheDocument();
  });
});
