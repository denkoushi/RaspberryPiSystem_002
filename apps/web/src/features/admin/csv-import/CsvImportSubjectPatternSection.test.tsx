import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createMutateAsync, subjectPatternData, csvDashboardsData } = vi.hoisted(() => ({
  createMutateAsync: vi.fn(),
  subjectPatternData: { patterns: [] },
  csvDashboardsData: [],
}));

vi.mock('../../../api/hooks', () => ({
  useCsvImportSubjectPatterns: () => ({ data: subjectPatternData, isLoading: false }),
  useCsvDashboards: () => ({ data: csvDashboardsData }),
  useCsvImportSubjectPatternMutations: () => ({
    create: { mutateAsync: createMutateAsync, isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

import { CsvImportSubjectPatternSection } from './CsvImportSubjectPatternSection';

describe('CsvImportSubjectPatternSection', () => {
  beforeEach(() => {
    createMutateAsync.mockReset();
  });

  it('shows the reserved-subject reason returned by the API', async () => {
    createMutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: {
          status: 400,
          data: {
            message:
              '「DocumentASM」は組立手順書専用の件名です。このメールに一致するCSV件名パターンは登録できません。',
            errorCode: 'GMAIL_SUBJECT_PATTERN_RESERVED',
          },
        },
      })
    );
    render(<CsvImportSubjectPatternSection />);

    fireEvent.change(screen.getAllByPlaceholderText('件名パターンを入力')[0]!, {
      target: { value: 'ASM' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: '+ 追加' })[0]!);

    expect(
      await screen.findByRole('alert')
    ).toHaveTextContent(
      '「DocumentASM」は組立手順書専用の件名です。このメールに一致するCSV件名パターンは登録できません。'
    );
  });
});
