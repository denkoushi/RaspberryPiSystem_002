import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureCleanView } from './AssemblyProcedureCleanView';

import type { CleanStep } from './cleanViewSteps';
import type { AssemblyProcedureImageOverlayElement } from '@raspi-system/shared-types';

vi.mock('../../../components/common/ProtectedImage', () => ({
  ProtectedImage: ({ path }: { path: string }) => <img src={path} alt="" />
}));

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

const photo: AssemblyProcedureImageOverlayElement = {
  kind: 'IMAGE', id: 'photo', assetId: 'photo', pageIndex: 0, zIndex: 0,
  bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.1 }
};

it('rebuilds the table in the enlarged row and shows photos in compressed rows', () => {
  const transcript = { assetId: 'photo', kind: 'table' as const, rows: [['品番'], ['A7000']], sel: [1], choices: [] };
  const { container } = render(<AssemblyProcedureCleanView name="組立要領書" pageNumber={1} pageCount={1}
    steps={[{ ...steps[0], images: [{ ...photo, transcript }] }, { ...steps[1], images: [{ ...photo, id: 'second-photo', assetId: 'other' }] }]} />);
  expect(container.querySelectorAll('img')).toHaveLength(2);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  fireEvent.click(firstButton());
  expect(screen.getByRole('columnheader', { name: '品番' })).toBeVisible();
  expect(screen.getByRole('cell', { name: 'A7000' }).closest('tr')).toHaveAttribute('data-selected', 'true');
  expect(container.querySelectorAll('img')).toHaveLength(1);
  expect(container.querySelector('img')).toHaveAttribute('src', '/api/storage/assembly-procedure-assets/other');
  fireEvent.click(secondButton());
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(container.querySelector('img[src$="/photo"]')).toBeVisible();
});

it('expands from a choice and toggles the outline and dimming on the corresponding list rows', () => {
  const transcript = { assetId: 'photo', kind: 'list' as const, title: 'シリーズ', rows: [['7000'], ['その他']],
    sel: [0], choices: [{ label: '7000シリーズ', color: '#ff0000', row: 0 }] };
  render(<AssemblyProcedureCleanView name="組立要領書" pageNumber={1} pageCount={1}
    steps={[{ ...steps[0], body: '1行目\n2行目', images: [{ ...photo, transcript }] }, steps[1]]} />);
  const choice = () => screen.getByRole('button', { name: '7000シリーズ' });
  fireEvent.click(choice());
  expect(firstButton()).toHaveAttribute('aria-pressed', 'true');
  expect(choice()).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('シリーズ')).toBeVisible();
  expect(screen.getByText('7000').closest('li')).toHaveAttribute('data-highlighted', 'true');
  expect(screen.getByText('その他').closest('li')).toHaveAttribute('data-dimmed', 'true');
  fireEvent.click(choice());
  expect(choice()).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByText('7000').closest('li')).toHaveAttribute('data-highlighted', 'false');
  expect(screen.getByText('その他').closest('li')).toHaveAttribute('data-dimmed', 'false');
  fireEvent.keyDown(choice(), { key: 'ArrowDown' });
  expect(secondButton()).toHaveFocus();
});

it('falls back to a photo in an enlarged row when its transcript belongs to an older asset', () => {
  const transcript = { assetId: 'before-rotation', kind: 'list' as const, rows: [['古い文字']], sel: [],
    choices: [{ label: '古い選択肢', color: '#ff0000', row: 0 }] };
  const { container } = render(<AssemblyProcedureCleanView name="組立要領書" pageNumber={1} pageCount={1}
    steps={[{ ...steps[0], images: [{ ...photo, transcript }] }]} />);
  fireEvent.click(firstButton());
  expect(container.querySelector('img')).toHaveAttribute('src', '/api/storage/assembly-procedure-assets/photo');
  expect(screen.queryByText('古い文字')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '古い選択肢' })).not.toBeInTheDocument();
});
