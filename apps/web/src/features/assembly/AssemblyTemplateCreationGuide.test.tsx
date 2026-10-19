import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyTemplateHeaderGuide } from './AssemblyTemplateCreationGuide';

import type { AssemblyTemplateReadiness } from './assemblyTemplateReadiness';

const readiness: AssemblyTemplateReadiness = {
  isReady: false,
  issues: [
    {
      code: 'basic.procedure_pattern.required',
      stage: 'basic',
      message: '手順パターンを入力してください。',
      target: { kind: 'basic', field: 'procedurePattern' }
    }
  ],
  stages: {
    basic: 'incomplete',
    procedure: 'complete',
    areas: 'complete',
    review: 'incomplete'
  }
};

describe('AssemblyTemplateHeaderGuide', () => {
  it('moves focus into requested issues and restores trigger focus on Escape', async () => {
    render(
      <AssemblyTemplateHeaderGuide
        readiness={readiness}
        readOnly={false}
        onStageClick={() => undefined}
        onIssueClick={() => undefined}
        onRetryCapabilityCatalog={() => undefined}
      />
    );

    const trigger = screen.getByRole('button', { name: '未完了 1件' });
    expect(screen.queryByRole('dialog', { name: 'テンプレートの未完了項目' })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'テンプレートの未完了項目' })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '手順パターンを入力してください。' })
      ).toHaveFocus()
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'テンプレートの未完了項目' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'テンプレートの未完了項目' })).not.toBeInTheDocument();
  });

  it('closes the overlay before forwarding an issue selection', () => {
    const onIssueClick = vi.fn();
    render(
      <AssemblyTemplateHeaderGuide
        readiness={readiness}
        readOnly={false}
        onStageClick={() => undefined}
        onIssueClick={onIssueClick}
        onRetryCapabilityCatalog={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '未完了 1件' }));
    fireEvent.click(screen.getByRole('button', { name: '手順パターンを入力してください。' }));
    expect(onIssueClick).toHaveBeenCalledWith(readiness.issues[0]);
    expect(screen.queryByRole('dialog', { name: 'テンプレートの未完了項目' })).not.toBeInTheDocument();
  });
});
