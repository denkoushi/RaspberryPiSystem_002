import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TorqueTrainingAdminDialog } from './TorqueTrainingAdminDialog';

import type { TorqueTrainingAdminController } from './useTorqueTrainingAdminController';

const makeController = (): TorqueTrainingAdminController =>
  ({
    adminBusy: false,
    adminPrograms: [
      { id: 'program-1', code: 'M10', isActive: true, currentVersion: 2 }
    ],
    adminResults: [
      {
        id: 'session-1',
        employeeCode: 'E001',
        employeeName: '作業者',
        programCode: 'M10',
        programVersion: 2,
        conditionFingerprint: 'condition-1',
        status: 'COMPLETED',
        excludedAt: null,
        exclusionReason: null,
        completedAt: '2026-08-17T00:00:00.000Z',
        metrics: {
          attemptCount: 5,
          passRate: 0.8,
          meanAbsoluteErrorPercent: 2.1,
          variationPercent: 1.2
        }
      }
    ],
    filteredAdminResults: [
      {
        id: 'session-1',
        employeeCode: 'E001',
        employeeName: '作業者',
        programCode: 'M10',
        programVersion: 2,
        conditionFingerprint: 'condition-1',
        status: 'COMPLETED',
        excludedAt: null,
        exclusionReason: null,
        completedAt: '2026-08-17T00:00:00.000Z',
        metrics: {
          attemptCount: 5,
          passRate: 0.8,
          meanAbsoluteErrorPercent: 2.1,
          variationPercent: 1.2
        }
      }
    ],
    adminTab: 'programs',
    capabilityGroups: [{ id: 'group-1', name: 'M10', nominalDiameter: '10' }],
    wrenchProfiles: [{ id: 'wrench-1', serialNumber: 'TW-001' }],
    programForm: {
      code: '',
      displayName: '',
      nominalDiameter: '',
      boltLengthMm: '',
      material: '',
      strengthClass: '',
      capabilityGroupId: '',
      nominalTorque: '',
      lowerLimit: '',
      upperLimit: '',
      unit: 'N-m',
      jigConditionCode: '',
      torqueWrenchProfileIds: []
    },
    revisionProgramId: '',
    resultQuery: '',
    exclusionReasons: {},
    error: null,
    message: null,
    setAdminTab: vi.fn(),
    updateProgramForm: vi.fn(),
    selectRevisionProgram: vi.fn(),
    setResultQuery: vi.fn(),
    setExclusionReason: vi.fn(),
    submitProgram: vi.fn().mockResolvedValue(undefined),
    deactivate: vi.fn().mockResolvedValue(undefined),
    excludeResult: vi.fn().mockResolvedValue(undefined)
  } as unknown as TorqueTrainingAdminController);

describe('TorqueTrainingAdminDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps admin settings in an opaque, bounded dialog and limits field widths', async () => {
    const controller = makeController();
    const trigger = document.createElement('button');
    trigger.textContent = '設定';
    document.body.append(trigger);
    trigger.focus();

    const view = render(
      <TorqueTrainingAdminDialog isOpen onClose={vi.fn()} controller={controller} />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveStyle({ zIndex: '80' });
    expect(dialog.className).toContain('bg-black/60');
    expect(document.body.querySelector('[class*="bg-slate-950"]')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '新版対象' }).className).toContain('max-w-xs');
    expect(await screen.findByRole('button', { name: '閉じる' })).toHaveFocus();

    controller.adminTab = 'results';
    view.rerender(<TorqueTrainingAdminDialog isOpen onClose={vi.fn()} controller={controller} />);
    const search = screen.getByRole('textbox', { name: '実績検索' });
    expect(search.parentElement?.className).toContain('max-w-md');
    const exclusion = screen.getByRole('textbox', { name: '除外理由' });
    expect(exclusion.parentElement?.className).toContain('max-w-sm');
  });

  it('does not close on backdrop clicks and returns focus after explicit close', async () => {
    const controller = makeController();
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    trigger.textContent = '設定';
    document.body.append(trigger);
    trigger.focus();

    render(<TorqueTrainingAdminDialog isOpen onClose={onClose} controller={controller} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows admin errors inside the dialog and delegates result exclusion', () => {
    const controller = makeController();
    controller.error = '保存できませんでした。';
    controller.adminTab = 'results';
    controller.exclusionReasons = { 'session-1': '再確認が必要' };

    render(<TorqueTrainingAdminDialog isOpen onClose={vi.fn()} controller={controller} />);

    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。');
    fireEvent.click(screen.getByRole('button', { name: '集計対象外' }));
    expect(controller.excludeResult).toHaveBeenCalledWith('session-1');
  });

  it('delegates revision selection and protects the existing code during a revision', () => {
    const controller = makeController();
    const view = render(<TorqueTrainingAdminDialog isOpen onClose={vi.fn()} controller={controller} />);

    const revisionSelect = screen.getByRole('combobox', { name: '新版対象' });
    fireEvent.change(revisionSelect, { target: { value: 'program-1' } });
    fireEvent.change(revisionSelect, { target: { value: '' } });

    expect(controller.selectRevisionProgram).toHaveBeenNthCalledWith(1, 'program-1');
    expect(controller.selectRevisionProgram).toHaveBeenNthCalledWith(2, '');

    controller.revisionProgramId = 'program-1';
    controller.programForm.code = 'M10';
    view.rerender(<TorqueTrainingAdminDialog isOpen onClose={vi.fn()} controller={controller} />);

    expect(screen.getByRole('textbox', { name: /メニューコード/ })).toBeDisabled();
    expect(screen.getByText('新版作成では既存のメニューコードを引き継ぎます。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'メニューを追加' })).toBeDisabled();
  });
});
