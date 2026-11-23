import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AssemblyProcedureCleanView } from './AssemblyProcedureCleanView';

import type { CleanStep } from './cleanViewSteps';

const steps: CleanStep[] = [
  { id: 'first', heading: '準備する', body: '準備の本文', images: [] },
  { id: 'second', heading: '組み立てる', body: '組立の本文', images: [] }
];
const firstButton = () => screen.getByRole('button', { name: '手順1 準備する' });
const secondButton = () => screen.getByRole('button', { name: '手順2 組み立てる' });

function renderPage() {
  render(<AssemblyProcedureCleanView name="組立要領書" pageNumber={4} pageCount={5} steps={steps} />);
}

describe('assembly procedure clean view', () => {
  it('shows the document header and expands or collapses the clicked row', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: '組立要領書' })).toBeVisible();
    expect(screen.getByText('4 / 5')).toBeVisible();
    fireEvent.click(screen.getByRole('heading', { name: '準備する' }));
    expect(firstButton()).toHaveAttribute('aria-pressed', 'true');
    expect(firstButton()).toHaveFocus();
    expect(screen.getByText('準備の本文')).toBeVisible();
    expect(secondButton()).toBeVisible();
    expect(screen.queryByText('組立の本文')).not.toBeInTheDocument();
    fireEvent.click(firstButton());
    expect(firstButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('組立の本文')).toBeVisible();
  });

  it('moves focus and expansion with the arrows and collapses with Escape', () => {
    renderPage();
    fireEvent.click(firstButton());
    fireEvent.keyDown(firstButton(), { key: 'ArrowDown' });
    expect(secondButton()).toHaveFocus();
    expect(secondButton()).toHaveAttribute('aria-pressed', 'true');
    expect(firstButton()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(secondButton(), { key: 'ArrowDown' });
    expect(secondButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(secondButton(), { key: 'ArrowUp' });
    expect(firstButton()).toHaveFocus();
    expect(firstButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(firstButton(), { key: 'Escape' });
    expect(firstButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('組立の本文')).toBeVisible();
  });
});
