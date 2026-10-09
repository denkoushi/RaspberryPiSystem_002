import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { ProcedureManualFilterPane } from './ProcedureManualFilterPane';

import type { ProcedureManualPartCandidateDto } from '../../../api/client';
import type { ProcedureManualProcessDto } from '../types';

const processes = [
  { id: 'assembly', parentId: 'parent', name: '組立工程', subjectKind: 'MODEL' },
  { id: 'cutting', parentId: 'machining', name: '切削', subjectKind: 'PART' },
  { id: 'grinding', parentId: 'machining', name: '研削', subjectKind: 'PART' }
] as ProcedureManualProcessDto[];

function Pane({ partSearchCandidates }: { partSearchCandidates?: ProcedureManualPartCandidateDto[] } = {}) {
  const [kind, setKind] = useState<'MODEL' | 'PART'>('MODEL');
  const [processId, setProcessId] = useState('');
  const [key, setKey] = useState('');
  const [search, setSearch] = useState('');
  const [digits, setDigits] = useState('');
  const clear = () => { setKey(''); setSearch(''); setDigits(''); };
  return <><ProcedureManualFilterPane processes={processes} items={[]} models={[{ modelCode: 'DFD1', modelCodeKey: 'DFD1' }]}
    partSearchCandidates={partSearchCandidates} partCandidates={[{ modelCode: 'PART-12', modelCodeKey: 'PART-12' }]} subjectKind={kind} processId={processId} modelCodeKey={key} search={search} digitQuery={digits}
    onSearchChange={setSearch} onDigitQueryChange={setDigits} onModelSelect={setKey}
    onKindChange={next => { setKind(next); clear(); }} onProcessSelect={id => { const next = processes.find(row => row.id === id)?.subjectKind ?? kind; if (next !== kind) clear(); setKind(next); setProcessId(id); }} />
    <output data-testid="selected">{key}</output></>;
}

describe('procedure manual subject pane', () => {
  it.each(['切削', '研削'])('switches to part candidates for %s and clears model selection/search', name => {
    render(<Pane />);
    fireEvent.click(screen.getByRole('button', { name: 'DFD1' }));
    fireEvent.change(screen.getByLabelText('機種検索'), { target: { value: 'DFD' } });
    fireEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByRole('region', { name: '部品一覧' })).toBeInTheDocument();
    expect(screen.getByLabelText('部品検索')).toHaveAttribute('placeholder', '品番で検索');
    expect(screen.getByLabelText('部品検索')).toHaveValue('');
    expect(screen.getByTestId('selected')).toHaveTextContent('');
    expect(screen.getByRole('button', { name: 'PART-12' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'DFD1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '機種か部品か' })).not.toBeInTheDocument();
  });

  it('toggles all-process candidates, selects an unassigned typed part and filters with digits', () => {
    render(<Pane />);
    fireEvent.click(screen.getByRole('button', { name: '部品' }));
    fireEvent.change(screen.getByLabelText('部品検索'), { target: { value: ' ｎｅｗ－① ' } });
    fireEvent.click(screen.getByRole('button', { name: 'NEW-1' }));
    expect(screen.getByTestId('selected')).toHaveTextContent('NEW-1');
    fireEvent.click(screen.getByRole('button', { name: '機種' }));
    expect(screen.getByTestId('selected')).toHaveTextContent('');
    expect(screen.getByLabelText('機種検索')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '部品' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByRole('button', { name: 'PART-12' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '9' }));
    expect(screen.queryByRole('button', { name: 'PART-12' })).not.toBeInTheDocument();
  });

  it('uses yellow selection and pressed/current attributes for kind switches and candidates', () => {
    render(<Pane />);
    const modelKind = screen.getByRole('button', { name: '機種' });
    const partKind = screen.getByRole('button', { name: '部品' });
    expect(modelKind).toHaveAttribute('aria-pressed', 'true');
    expect(modelKind).toHaveClass('border-[#f6b93b]', 'bg-[#f6b93b]', 'text-[#0b1a12]');
    expect(partKind).toHaveAttribute('aria-pressed', 'false');
    expect(partKind).toHaveClass('border-[#344252]');
    for (const [kindButton, code] of [[modelKind, 'DFD1'], [partKind, 'PART-12']] as const) {
      fireEvent.click(kindButton);
      const candidate = screen.getByRole('button', { name: code });
      expect(candidate).toHaveAttribute('aria-pressed', 'false');
      expect(candidate).toHaveClass('border-[#344252]');
      fireEvent.click(candidate);
      expect(candidate).toHaveAttribute('aria-pressed', 'true');
      expect(candidate).toHaveAttribute('aria-current', 'true');
      expect(candidate).toHaveClass('border-[#f6b93b]', 'bg-[#f6b93b]', 'text-[#0b1a12]');
      expect(kindButton).toHaveClass('bg-[#f6b93b]');
    }
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass('min-h-12', 'rounded-lg', 'focus-visible:outline', 'focus-visible:outline-2', 'focus-visible:outline-[#7cc4ff]');
    }
  });

  it('renders named API candidates without local text/digit filtering and falls back to a single part number', () => {
    render(<Pane partSearchCandidates={[
      { partNumber: 'P-1A3', partNumberKey: 'P-1A3', partName: '主軸', hasManual: false },
      { partNumber: 'P-13', partNumberKey: 'P-13', partName: null, hasManual: false }
    ]} />);
    fireEvent.click(screen.getByRole('button', { name: '部品' }));
    fireEvent.change(screen.getByLabelText('部品検索'), { target: { value: '主軸' } });
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    const candidate = screen.getByRole('button', { name: 'P-1A3' });
    expect(candidate).toHaveTextContent('主軸');
    expect(candidate).toHaveTextContent('P-1A3');
    expect(candidate.querySelector('.text-sm')).toHaveClass('text-[#9fadb9]');
    expect(screen.getByRole('button', { name: 'P-13' }).textContent).toBe('P-13—');
    expect(screen.queryByRole('button', { name: 'PART-12' })).not.toBeInTheDocument();
    fireEvent.click(candidate);
    expect(candidate).toHaveAttribute('aria-pressed', 'true');
    expect(candidate).toHaveClass('min-h-12', 'bg-[#f6b93b]');
  });

  it('arms one scan and selects a previously unassigned normalized part', () => {
    render(<Pane />);
    fireEvent.click(screen.getByRole('button', { name: '切削' }));
    fireEvent.click(screen.getByRole('button', { name: '品番をスキャン' }));
    expect(screen.getByRole('button', { name: 'スキャン中止' })).toHaveClass('border-[#f6b93b]', 'bg-[#f6b93b]', 'text-[#0b1a12]');
    for (const key of 'new-123') fireEvent.keyDown(window, { key });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByTestId('selected')).toHaveTextContent('NEW-123');
    expect(screen.getByRole('button', { name: '品番をスキャン' })).toHaveAttribute('aria-pressed', 'false');
    for (const key of 'other-456') fireEvent.keyDown(window, { key });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByTestId('selected')).toHaveTextContent('NEW-123');
  });
});
