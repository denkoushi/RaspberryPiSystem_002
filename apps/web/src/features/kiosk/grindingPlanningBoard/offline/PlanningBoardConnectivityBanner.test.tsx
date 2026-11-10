import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PlanningBoardConnectivityBanner } from './PlanningBoardConnectivityBanner';

afterEach(() => document.getElementById('planning-board-connectivity-slot')?.remove());
function slot() { const element = document.createElement('div'); element.id = 'planning-board-connectivity-slot'; document.body.appendChild(element); return element; }
describe('PlanningBoardConnectivityBanner', () => {
  it('portals the amber banner above the scaled page and formats its fixed server timestamp', () => {
    const target = slot();
    const view = render(<PlanningBoardConnectivityBanner phase="offline" displayedAt={Date.parse('2026-11-10T03:45:00Z')} recoveredUntil={null} />);
    expect(view.container).toBeEmptyDOMElement(); expect(target).toContainElement(screen.getByRole('status'));
    expect(screen.getByRole('status')).toHaveTextContent('圏外操作できません12:45 の表示');
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByRole('status')).toHaveStyle({ background: '#fbbf24', color: '#1c1300' });
    view.rerender(<PlanningBoardConnectivityBanner phase="refreshing" displayedAt={null} recoveredUntil={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('--:-- の表示');
  });
  it('shows the recovery text only while its monotonic deadline is present and removes the portal on unmount', () => {
    slot(); const view = render(<PlanningBoardConnectivityBanner phase="online" displayedAt={null} recoveredUntil={123} />);
    expect(screen.getByRole('status')).toHaveTextContent('復帰最新に更新しました');
    expect(screen.getByRole('status')).toHaveStyle({ background: '#34d399', color: '#03251a' });
    view.rerender(<PlanningBoardConnectivityBanner phase="online" displayedAt={null} recoveredUntil={null} />);
    expect(screen.queryByRole('status')).toBeNull();
    view.rerender(<PlanningBoardConnectivityBanner phase="offline" displayedAt={null} recoveredUntil={null} />);
    view.unmount(); expect(screen.queryByRole('status')).toBeNull();
  });
});
