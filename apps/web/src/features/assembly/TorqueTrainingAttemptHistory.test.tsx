import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TorqueTrainingAttemptHistory } from './TorqueTrainingAttemptHistory';

describe('TorqueTrainingAttemptHistory', () => {
  it('renders one compact five-attempt list with empty slots', () => {
    render(
      <TorqueTrainingAttemptHistory
        recordedCount={1}
        items={[
          {
            key: 'attempt-1',
            attemptNo: 1,
            recordedAt: '2026-08-17T00:00:00.000Z',
            valueLabel: '10 Nm',
            resultLabel: 'OK',
            resultTone: 'success',
            details: '目標 10 Nm / 差 0%'
          },
          null,
          null,
          null,
          null
        ]}
        outOfSequenceItems={[
          {
            key: 'attempt-ignored',
            attemptNo: null,
            recordedAt: '2026-08-17T00:01:00.000Z',
            valueLabel: '-',
            resultLabel: '記録外',
            resultTone: 'neutral',
            details: '除外理由あり'
          }
        ]}
      />
    );

    const history = screen.getByRole('region', { name: '訓練試行履歴' });
    expect(history).toHaveClass('max-w-lg');
    expect(history.querySelectorAll('[data-testid^="torque-training-attempt-"]')).toHaveLength(6);
    expect(history).toHaveTextContent('記録 1 / 5');
    expect(history).not.toHaveTextContent('合格');
    expect(history).toHaveTextContent('未記録');
    expect(within(history).getByTestId('torque-training-attempt-1')).toHaveTextContent('OK');
    expect(within(history).getByTestId('torque-training-attempt-out-of-sequence-attempt-ignored')).toHaveTextContent('記録外');
  });

  it('shows under and over results as recorded outcomes, not as passed count', () => {
    render(
      <TorqueTrainingAttemptHistory
        recordedCount={2}
        items={[
          {
            key: 'attempt-under',
            attemptNo: 1,
            recordedAt: '2026-08-17T00:00:00.000Z',
            valueLabel: '9 Nm',
            resultLabel: '弱い',
            resultTone: 'failure'
          },
          {
            key: 'attempt-over',
            attemptNo: 2,
            recordedAt: '2026-08-17T00:00:00.000Z',
            valueLabel: '11 Nm',
            resultLabel: '強い',
            resultTone: 'failure'
          }
        ]}
      />
    );

    const history = screen.getByRole('region', { name: '訓練試行履歴' });
    expect(history).toHaveTextContent('記録 2 / 2');
    expect(history).not.toHaveTextContent('合格');
    expect(history).toHaveTextContent('弱い');
    expect(history).toHaveTextContent('強い');
  });
});
