import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { InspectionDrawingProposalPanel } from './InspectionDrawingProposalPanel';

import type { DrawingProposalMarker } from './proposalToDrawingPoint';
import type { DrawingProposalTab } from './useInspectionDrawingPlacementProposals';

const row: DrawingProposalMarker = {
  id: 'proposal-1', sortOrder: 0, measurementLabel: '内径', measurementPoint: null,
  nominalValue: 56, lowerLimit: 55.98, upperLimit: 56.03, decimalPlaces: 3,
  depthMode: 'measured', valueKind: 'numeric', markerXRatio: 0.3, markerYRatio: 0.4,
  anchorXRatio: null, anchorYRatio: null, dimensionText: 'Φ56 h7', markerNo: 4
};
const unplaced = { ...row, id: 'unplaced-1', reason: 'no-candidate' as const };

function renderPanel({ empty = false, disabled = false } = {}) {
  const approve = vi.fn();
  const reject = vi.fn();
  const approveAll = vi.fn();
  const arm = vi.fn();
  const selectProposal = vi.fn();
  function Harness() {
    const [proposals, setProposals] = useState(empty ? [] : [row]);
    const [tab, setTab] = useState<DrawingProposalTab>('proposals');
    const [armedId, setArmedId] = useState<string | null>(null);
    return (
      <InspectionDrawingProposalPanel
        confirmedCount={3}
        disabled={disabled}
        placement={{
          proposals, unplaced: empty ? [] : [unplaced], sourceDrawingName: '兄弟図面.png',
          tab, setTab, selectedProposalId: null, armedId, approve, approveAll, selectProposal,
          reject: (proposal) => {
            reject(proposal);
            setProposals((previous) => previous.filter((candidate) => candidate.id !== proposal.id));
          },
          arm: (candidate) => { arm(candidate); setArmedId(candidate.id); }
        }}
      >
        <div>既存の確定点パネル</div>
      </InspectionDrawingProposalPanel>
    );
  }
  render(<Harness />);
  return { approve, reject, approveAll, arm, selectProposal };
}

describe('InspectionDrawingProposalPanel', () => {
  it('selects, approves and bulk approves with the displayed proposal', () => {
    const callbacks = renderPanel();
    expect(screen.getByText('内径', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Φ56 h7')).toBeInTheDocument();
    expect(screen.getByText('55.98〜56.03')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'AI案 4 内径 を選択' }));
    expect(callbacks.selectProposal).toHaveBeenCalledWith(row.id);
    fireEvent.click(screen.getByRole('button', { name: 'AI案 4 を承認' }));
    expect(callbacks.approve).toHaveBeenCalledWith(row);
    fireEvent.click(screen.getByRole('button', { name: 'まとめて承認（1）' }));
    expect(callbacks.approveAll).toHaveBeenCalledOnce();
  });

  it('rejects and removes the proposal row', () => {
    const { reject } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'AI案 4 を却下' }));
    expect(reject).toHaveBeenCalledWith(row);
    expect(screen.queryByRole('button', { name: 'AI案 4 内径 を選択' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI案 0' })).toBeInTheDocument();
  });

  it('switches tabs and shows the armed placement state', () => {
    const { arm } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '未配置 1' }));
    expect(screen.queryByText('同じ値が図面に見つからない')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '内径 を置く' }));
    expect(arm).toHaveBeenCalledWith(unplaced);
    expect(screen.getByRole('button', { name: '内径 を置く' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('配置待ち')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確定 3' }));
    expect(screen.getByText('既存の確定点パネル')).toBeInTheDocument();
  });

  it('renders only the unchanged confirmed panel when there are no proposals or unplaced rows', () => {
    renderPanel({ empty: true });
    expect(screen.getByText('既存の確定点パネル')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '測定点の種類' })).not.toBeInTheDocument();
  });

  it('disables decision and placement actions during a save', () => {
    const { approve, reject } = renderPanel({ disabled: true });
    const approveButton = screen.getByRole('button', { name: 'AI案 4 を承認' });
    expect(approveButton).toBeDisabled();
    fireEvent.click(approveButton);
    fireEvent.click(screen.getByRole('button', { name: 'AI案 4 を却下' }));
    expect(approve).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'まとめて承認（1）' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '未配置 1' }));
    expect(screen.getByRole('button', { name: '内径 を置く' })).toBeDisabled();
  });

  it('switches to the AI案 tab and scrolls the row of a proposal chosen on the drawing into view', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    onTestFinished(() => { Element.prototype.scrollIntoView = original; });
    const lower = { ...row, id: 'proposal-2', markerNo: 9, measurementLabel: '外径' };
    function Harness() {
      const [tab, setTab] = useState<DrawingProposalTab>('confirmed');
      const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
      // 図面の丸数字を押したときの選択（useInspectionDrawingPlacementProposals.selectProposal と同じく AI案タブへ切り替える）
      const selectProposal = (id: string) => { setSelectedProposalId(id); setTab('proposals'); };
      return (
        <>
          <button type="button" onClick={() => selectProposal(lower.id)}>図面の丸数字 9</button>
          <InspectionDrawingProposalPanel
            confirmedCount={3}
            placement={{
              proposals: [row, lower], unplaced: [], sourceDrawingName: null,
              tab, setTab, selectedProposalId, armedId: null, approve: vi.fn(), approveAll: vi.fn(),
              selectProposal, reject: vi.fn(), arm: vi.fn()
            }}
          >
            <div>既存の確定点パネル</div>
          </InspectionDrawingProposalPanel>
        </>
      );
    }
    render(<Harness />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '図面の丸数字 9' }));

    expect(screen.getByRole('button', { name: 'AI案 2' })).toHaveAttribute('aria-pressed', 'true');
    const selectedRow = screen.getByRole('button', { name: 'AI案 9 外径 を選択' }).closest('li');
    expect(selectedRow).toHaveClass('ring-2');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(selectedRow);
  });
});
