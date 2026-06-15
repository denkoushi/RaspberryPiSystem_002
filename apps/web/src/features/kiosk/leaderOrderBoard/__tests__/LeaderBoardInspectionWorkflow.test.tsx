import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LeaderBoardInspectionWorkflowModal } from '../LeaderBoardInspectionWorkflowModal';
import { LeaderOrderResourceRow } from '../LeaderOrderResourceRow';

import { mkLeaderBoardRow } from './leaderBoardRowTestFixtures';

const noop = vi.fn();

describe('leader board inspection workflow', () => {
  it('opens workflow from inspection button instead of navigating directly', () => {
    const row = mkLeaderBoardRow({
      id: 'row-1',
      hasSelfInspectionDrawing: true,
      selfInspectionTemplateId: 'tpl-1',
      selfInspectionEntryPath: '/kiosk/part-measurement/self-inspection/start?templateId=tpl-1'
    });
    const onOpenInspectionWorkflow = vi.fn();

    render(
      <LeaderOrderResourceRow
        resourceCd="305"
        row={row}
        orderUsageNumbers={undefined}
        onOrderChange={noop}
        onCompleteRow={noop}
        completePending={false}
        orderPending={false}
        onOpenInspectionWorkflow={onOpenInspectionWorkflow}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '検査方法を選択' }));
    expect(onOpenInspectionWorkflow).toHaveBeenCalledWith(row);
  });

  it('opens workflow for paper-only rows without a digital entry path', () => {
    const row = mkLeaderBoardRow({
      id: 'row-paper-only',
      hasSelfInspectionDrawing: true,
      selfInspectionTemplateId: 'tpl-paper',
      selfInspectionEntryPath: null
    });
    const onOpenInspectionWorkflow = vi.fn();

    render(
      <LeaderOrderResourceRow
        resourceCd="305"
        row={row}
        orderUsageNumbers={undefined}
        onOrderChange={noop}
        onCompleteRow={noop}
        completePending={false}
        orderPending={false}
        onOpenInspectionWorkflow={onOpenInspectionWorkflow}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '検査方法を選択' }));
    expect(onOpenInspectionWorkflow).toHaveBeenCalledWith(row);
  });

  it('offers digital input and paper print actions', () => {
    const row = mkLeaderBoardRow({
      id: 'row-1',
      fseiban: 'S1',
      fhincd: 'MH001',
      fhinmei: '部品A',
      hasSelfInspectionDrawing: true,
      selfInspectionTemplateId: 'tpl-1',
      selfInspectionEntryPath: '/kiosk/part-measurement/self-inspection/start?templateId=tpl-1'
    });
    const onOpenDigitalInput = vi.fn();
    const onOpenPaperPrint = vi.fn();

    render(
      <LeaderBoardInspectionWorkflowModal
        row={row}
        onClose={noop}
        onOpenDigitalInput={onOpenDigitalInput}
        onOpenPaperPrint={onOpenPaperPrint}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'デジタル入力' }));
    fireEvent.click(screen.getByRole('button', { name: '帳票紙印刷' }));

    expect(onOpenDigitalInput).toHaveBeenCalledWith(row);
    expect(onOpenPaperPrint).toHaveBeenCalledWith(row);
  });

  it('disables digital input but keeps paper print available for paper-only rows', () => {
    const row = mkLeaderBoardRow({
      id: 'row-paper-only',
      fseiban: 'S1',
      fhincd: 'MH001',
      fhinmei: '部品A',
      hasSelfInspectionDrawing: true,
      selfInspectionTemplateId: 'tpl-paper',
      selfInspectionEntryPath: null
    });
    const onOpenDigitalInput = vi.fn();
    const onOpenPaperPrint = vi.fn();

    render(
      <LeaderBoardInspectionWorkflowModal
        row={row}
        onClose={noop}
        onOpenDigitalInput={onOpenDigitalInput}
        onOpenPaperPrint={onOpenPaperPrint}
      />
    );

    expect(screen.getByRole('button', { name: 'デジタル入力' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '帳票紙印刷' }));

    expect(onOpenDigitalInput).not.toHaveBeenCalled();
    expect(onOpenPaperPrint).toHaveBeenCalledWith(row);
  });
});
