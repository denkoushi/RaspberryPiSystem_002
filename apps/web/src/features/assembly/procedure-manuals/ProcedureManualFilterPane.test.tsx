import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { ProcedureManualFilterPane } from './ProcedureManualFilterPane';

import type { ProcedureManualProcessDto } from '../types';

const processes = [
  { id: 'assembly', parentId: 'parent', name: '組立工程', subjectKind: 'MODEL' },
  { id: 'cutting', parentId: 'machining', name: '切削', subjectKind: 'PART' },
  { id: 'grinding', parentId: 'machining', name: '研削', subjectKind: 'PART' }
] as ProcedureManualProcessDto[];

function Pane() {
  const [kind, setKind] = useState<'MODEL' | 'PART'>('MODEL');
  const [processId, setProcessId] = useState('');
  const [key, setKey] = useState('');
  const [search, setSearch] = useState('');
  const [digits, setDigits] = useState('');
  const clear = () => { setKey(''); setSearch(''); setDigits(''); };
  return <><ProcedureManualFilterPane processes={processes} items={[]} models={[{ modelCode: 'DFD1', modelCodeKey: 'DFD1' }]}
    partCandidates={[{ modelCode: 'PART-12', modelCodeKey: 'PART-12' }]} subjectKind={kind} processId={processId} modelCodeKey={key} search={search} digitQuery={digits}
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

  it('arms one scan and selects a previously unassigned normalized part', () => {
    render(<Pane />);
    fireEvent.click(screen.getByRole('button', { name: '切削' }));
    fireEvent.click(screen.getByRole('button', { name: '品番をスキャン' }));
    for (const key of 'new-123') fireEvent.keyDown(window, { key });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByTestId('selected')).toHaveTextContent('NEW-123');
    expect(screen.getByRole('button', { name: '品番をスキャン' })).toHaveAttribute('aria-pressed', 'false');
    for (const key of 'other-456') fireEvent.keyDown(window, { key });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByTestId('selected')).toHaveTextContent('NEW-123');
  });
});
