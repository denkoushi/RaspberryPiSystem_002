import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlanningBoardSeibanDrawer } from './PlanningBoardSeibanDrawer';

describe('PlanningBoardSeibanDrawer candidate picker', () => {
  it('groups candidates by machine, sorts by due date, filters, and bulk registers', async () => {
    const onRegisterMany = vi.fn(async () => true);
    render(
      <PlanningBoardSeibanDrawer
        isOpen
        registeredFseibans={['REGISTERED-1']}
        selectedFseibans={new Set()}
        candidateData={{
          today: '2026-09-11',
          rangeStart: '2026-08-11',
          rangeEnd: '2026-10-11',
          completionFilter: 'incomplete',
          candidates: [
            { fseiban: 'SEIBAN-LATE', machineName: '機種A', dueDate: '2026-09-20', completedProcessCount: 0, totalProcessCount: 2, isCompleted: false },
            { fseiban: 'SEIBAN-EARLY', machineName: '機種A', dueDate: '2026-09-12', completedProcessCount: 1, totalProcessCount: 2, isCompleted: false },
            { fseiban: 'SEIBAN-OVERDUE', machineName: '機種B', dueDate: '2026-09-10', completedProcessCount: 0, totalProcessCount: 1, isCompleted: false }
          ]
        }}
        showCompletedCandidates={false}
        onShowCompletedCandidatesChange={vi.fn()}
        onRegisterMany={onRegisterMany}
        onClose={vi.fn()}
        onRegister={vi.fn(async () => true)}
        onRemove={vi.fn()}
        onToggle={vi.fn()}
        onOpenDueDetail={vi.fn()}
        onClear={vi.fn()}
        onMove={vi.fn()}
      />
    );

    const machineA = screen.getByRole('button', { name: /機種A（2）/ });
    expect(machineA).toHaveAttribute('aria-expanded', 'true');
    const candidateSection = screen.getByRole('heading', { name: '納期範囲の候補' }).closest('section');
    if (!candidateSection) throw new Error('candidate section is missing');
    const candidateText = candidateSection.textContent ?? '';
    expect(candidateText.indexOf('SEIBAN-EARLY')).toBeLessThan(candidateText.indexOf('SEIBAN-LATE'));
    expect(screen.getByText(/期限超過/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('候補を機種名で絞り込み'), { target: { value: '機種B' } });
    expect(screen.queryByText('SEIBAN-EARLY')).not.toBeInTheDocument();
    expect(screen.getByText('SEIBAN-OVERDUE')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('候補を機種名で絞り込み'), { target: { value: '' } });
    const candidateCheckboxes = within(candidateSection).getAllByRole('checkbox');
    fireEvent.click(candidateCheckboxes[2]!);
    fireEvent.click(candidateCheckboxes[1]!);
    expect(screen.getByRole('button', { name: '選択した製番を登録（2件）' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '選択した製番を登録（2件）' }));
    await waitFor(() => expect(onRegisterMany).toHaveBeenCalledWith(['SEIBAN-LATE', 'SEIBAN-EARLY']));
  });
});
