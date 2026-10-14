import type { BusinessHermesOperationGuideDisplay } from '../../api/domains/assembly';

function renderBody(body: string) {
  const blocks: Array<{ kind: 'ol' | 'ul' | 'p'; lines: string[] }> = [];
  let current: (typeof blocks)[number] | undefined;
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) {
      current = undefined;
      continue;
    }
    const ordered = /^\d+\. (.*)$/.exec(line);
    const unordered = /^- (.*)$/.exec(line);
    const kind = ordered ? 'ol' : unordered ? 'ul' : 'p';
    if (!current || current.kind !== kind) {
      current = { kind, lines: [] };
      blocks.push(current);
    }
    current.lines.push(ordered?.[1] ?? unordered?.[1] ?? line);
  }
  return blocks.map((block, index) => {
    if (block.kind === 'p') return <p key={index}>{block.lines.join('\n')}</p>;
    const List = block.kind;
    return <List key={index}>{block.lines.map((line, itemIndex) => <li key={itemIndex}>{line}</li>)}</List>;
  });
}

export function HermesOperationGuideAnswer({ guide }: { guide: BusinessHermesOperationGuideDisplay }) {
  return <article className="hermes-chat-panel__guide-answer">
    <h2>{guide.screen}</h2>
    {guide.sections.map((section, index) => <section key={index} className="hermes-chat-panel__guide-answer-section">
      <h3>{section.heading}</h3>
      {renderBody(section.body)}
    </section>)}
  </article>;
}
