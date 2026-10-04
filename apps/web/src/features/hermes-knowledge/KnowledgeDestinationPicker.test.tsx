import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/http';

import { KnowledgeDestinationChip, KnowledgeDestinationPicker } from './KnowledgeDestinationPicker';
import { KnowledgeFieldPicker } from './KnowledgeFieldPicker';
import { KnowledgeIntakePanel } from './KnowledgeIntakePanel';
import { useKnowledgeDestination } from './useKnowledgeDestination';
import { useKnowledgeIntake } from './useKnowledgeIntake';

import type { KnowledgePoster } from './useKnowledgePoster';
import type { KnowledgeFieldNode } from '@raspi-system/shared-types';

vi.mock('../../api/http', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const fields: KnowledgeFieldNode[] = [
  { id: 'r1', name: '加工', aliases: [], children: [{ id: 'c1', name: '切削', aliases: [], children: [{ id: 'g1', name: '穴あけ・タップ', aliases: [], children: [] }] }] },
  { id: 'r2', name: '事務・教育', aliases: [], children: [{ id: 'c2', name: '各種申請', aliases: [], children: [] }] },
];
let noTopics = false;
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); noTopics = false;
  vi.mocked(api.get).mockImplementation(async (url, config) => ({ data: url.endsWith('/capabilities') ? { enabled: true }
    : url.endsWith('/subjects') ? { subjects: [{ target: 'P-A', topicCount: 2 }] }
      : url.endsWith('/fields') ? { fields }
        : url.endsWith('/procedure-topics') ? { topics: noTopics ? [] : [{ procedureId: 'p1', title: 'P-A｜段取り', parts: { target: config?.params.target ?? 'P-A', workType: '段取り' } }] }
          : { intakes: [] } }));
  vi.mocked(api.post).mockImplementation(async (url, body) => {
    if (url.endsWith('/subjects/recent')) return { data: { subjects: [{ target: 'P-A', topicCount: 2 }] } };
    return { data: { id: 'post-1', text: body.text, files: [], state: 'ready', version: 1, message: '追加しました', choices: [], errorCode: null,
      triage: { state: body.destination ? 'decided' : 'awaiting', suggestions: null, decidedProcedureId: body.destination ? 'p1' : null } } };
  });
});
function Harness({ scanned = null, context = null }: { scanned?: string | null; context?: string | null }) {
  const [poster, setPoster] = useState<KnowledgePoster | null>({ tagUid: 'tag-1', name: '田中' });
  const [partNumber, setPartNumber] = useState(scanned); const [text, setText] = useState('');
  const intake = useKnowledgeIntake('client:one', null, true);
  const d = useKnowledgeDestination(poster, partNumber, context ? { path: '/test', entity: { kind: 'partNumber', value: context } } : null);
  return <>
    <button type="button" onClick={() => setPoster({ tagUid: 'tag-1', name: '田中' })}>タグをかざす</button>
    <KnowledgeDestinationChip destination={d} />
    {poster ? <KnowledgeDestinationPicker destination={d} partNumber={partNumber} onScan={() => setPartNumber('SCAN-1')} /> : null}
    {d.ready && poster ? <form onSubmit={event => { event.preventDefault(); void intake.receive(text, { tagUid: poster.tagUid, partNumber, destination: d.destination }, () => setPoster(null)); }}>
      <input aria-label="メモ" value={text} onChange={event => setText(event.target.value)} /><button type="submit">送信</button>
    </form> : null}
    <KnowledgeIntakePanel items={intake.items} error={intake.error} busy={intake.busy} onChoose={() => {}} onDelegate={() => {}}
      triage={{ tagFor: intake.tagFor, decided: intake.decided, later: intake.later, onDecided: intake.markDecided, onLater: intake.markLater }} />
  </>;
}
const subject = () => screen.findByRole('button', { name: 'P-A 2' });
const send = async () => { fireEvent.change(await screen.findByRole('textbox', { name: 'メモ' }), { target: { value: '記録' } }); fireEvent.click(screen.getByRole('button', { name: '送信' })); await screen.findByText('追加しました'); };

describe('knowledge destination first', () => {
  it('hides the composer until subject and topic are chosen, posts the destination, skips the card and requires a new tag', async () => {
    render(<Harness />);
    expect(screen.queryByRole('textbox', { name: 'メモ' })).not.toBeInTheDocument();
    fireEvent.click(await subject());
    fireEvent.click(await screen.findByRole('button', { name: '段取り' }));
    await send();
    expect(api.post).toHaveBeenCalledWith('/hermes-knowledge/intakes', expect.objectContaining({ destination: { procedureId: 'p1' } }));
    expect(screen.queryByRole('region', { name: '投稿の仕分け' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'メモ' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'タグをかざす' }));
    await subject(); expect(screen.queryByRole('textbox', { name: 'メモ' })).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/hermes-knowledge/subjects/recent', { posterTagUid: 'tag-1' }, expect.anything());
    expect(vi.mocked(api.get).mock.calls.some(([url]) => url.includes('tag-1'))).toBe(false);
    expect(api.get).toHaveBeenCalledWith('/hermes-knowledge/procedure-topics', expect.objectContaining({ params: { q: '', target: 'P-A' } }));
  });
  it.each(['加工', '切削', '穴あけ・タップ'])('creates a new topic by traversing fields and deciding at %s', async chosen => {
    noTopics = true; render(<Harness />); fireEvent.click(await subject());
    fireEvent.click(await screen.findByRole('button', { name: '加工' }));
    if (chosen !== '加工') fireEvent.click(screen.getByRole('button', { name: '切削' }));
    if (chosen === '穴あけ・タップ') fireEvent.click(screen.getByRole('button', { name: chosen }));
    expect(screen.getByText('承認が要る')).toBeInTheDocument();
    // A leaf is chosen by its own tap; only intermediate levels need the confirm button.
    if (chosen !== '穴あけ・タップ') fireEvent.click(screen.getByRole('button', { name: 'ここで決定' }));
    fireEvent.change(screen.getByLabelText('補足(任意)'), { target: { value: '手順' } });
    fireEvent.click(screen.getByRole('button', { name: '決定' })); await send();
    expect(api.post).toHaveBeenCalledWith('/hermes-knowledge/intakes', expect.objectContaining({ destination: { newTopic: { target: 'P-A', workType: chosen, detail: '手順' } } }));
  });
  it('keeps a selected page-context part number as an identifier even for office fields', async () => {
    noTopics = true; render(<Harness context="CONTEXT-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'CONTEXT-1' }));
    fireEvent.click(await screen.findByRole('button', { name: '事務・教育' }));
    fireEvent.click(screen.getByRole('button', { name: '各種申請' }));
    expect(screen.getAllByText('承認が要る')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '決定' })); await send();
    expect(api.post).toHaveBeenCalledWith('/hermes-knowledge/intakes', expect.objectContaining({ destination: { newTopic: {
      target: 'CONTEXT-1', workType: '各種申請', partNumber: 'CONTEXT-1',
    } } }));
  });
  it('keeps field buttons, including navigation and confirmation, within nine per screen', async () => {
    const onChange = vi.fn();
    vi.mocked(api.get).mockResolvedValue({ data: { fields: [{ id: 'root', name: '加工', aliases: [], children:
      Array.from({ length: 8 }, (_, index) => ({ id: `field-${index}`, name: `分野${index + 1}`, aliases: [], children: [] })) }] } });
    render(<KnowledgeFieldPicker value="" onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: '加工' }));
    expect(screen.getByRole('group', { name: '分野' }).querySelectorAll('button')).toHaveLength(9);
    expect(screen.queryByRole('button', { name: '分野8' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '次' }));
    fireEvent.click(screen.getByRole('button', { name: '分野8' }));
    expect(onChange).toHaveBeenLastCalledWith('分野8', '加工');
  });
  it('retains auto-routing without a destination, then shows the triage card', async () => {
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'おまかせ' })); await send();
    const payload = vi.mocked(api.post).mock.calls.find(([url]) => url.endsWith('/intakes'))?.[1];
    expect(payload).not.toHaveProperty('destination');
    expect(screen.getByRole('region', { name: '投稿の仕分け' })).toBeInTheDocument();
  });
  it('clears the destination with the chip and uses the existing scanner result as the subject query', async () => {
    render(<Harness context="CONTEXT-1" />);
    expect(screen.getByRole('button', { name: 'CONTEXT-1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'おまかせ' }));
    expect(screen.getByRole('textbox', { name: 'メモ' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '行き先を選び直す' }));
    expect(screen.queryByRole('textbox', { name: 'メモ' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '▮▯ 読取' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '品番・設備・事柄' })).toHaveValue('SCAN-1'));
    expect(screen.getByRole('button', { name: '＋ 新しい対象' })).toBeEnabled();
  });
});
