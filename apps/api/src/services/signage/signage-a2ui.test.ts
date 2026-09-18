import { describe, expect, it } from 'vitest';

import { parseSignageA2uiProposal } from './signage-a2ui.js';

const layoutMessage = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'signage',
    components: [
      { id: 'root', component: 'Column', children: ['title', 'chart'] },
      { id: 'title', component: 'Text', text: { path: '/screen/title' }, variant: 'h1' },
      { id: 'chart', component: 'BarChart', data: { path: '/schedule/progress' } },
    ],
  },
};

const dataMessage = {
  version: 'v0.9',
  updateDataModel: {
    surfaceId: 'signage',
    path: '/',
    value: {
      screen: { title: '組立ライン進捗' },
      schedule: { progress: [{ label: '完了', value: 72 }, { label: '残り', value: 28 }] },
    },
  },
};

describe('signage A2UI boundary', () => {
  it('accepts official v0.9 layout/data messages for the business catalog', () => {
    expect(parseSignageA2uiProposal({ layoutMessage, dataMessage })).toEqual({ layoutMessage, dataMessage });
  });

  it('rejects an untyped path and cyclic component tree', () => {
    const unknownPath = structuredClone(layoutMessage);
    (unknownPath.updateComponents.components[1] as { text: unknown }).text = { path: '/private/secret' };
    expect(parseSignageA2uiProposal({ layoutMessage: unknownPath, dataMessage })).toBeUndefined();

    const cyclicLayout = structuredClone(layoutMessage);
    (cyclicLayout.updateComponents.components[0] as { children: string[] }).children = ['root'];
    expect(parseSignageA2uiProposal({ layoutMessage: cyclicLayout, dataMessage })).toBeUndefined();
  });

  it('rejects Text styling properties that the official renderer does not support', () => {
    const invalid = structuredClone(layoutMessage);
    Object.assign(invalid.updateComponents.components[1]!, { color: '#ffffff', align: 'middle' });
    expect(parseSignageA2uiProposal({ layoutMessage: invalid, dataMessage })).toBeUndefined();
  });

  it('rejects an unsafe image URL even when the wire message is otherwise valid', () => {
    const imageLayout = {
      ...layoutMessage,
      updateComponents: {
        ...layoutMessage.updateComponents,
        components: [
          { id: 'root', component: 'Image', url: { path: '/workInstruction/photoUrl' }, description: { path: '/workInstruction/description' } },
        ],
      },
    };
    const unsafeData = {
      ...dataMessage,
      updateDataModel: {
        ...dataMessage.updateDataModel,
        value: {
          workInstruction: {
            photoUrl: 'javascript:alert(1)',
            description: '写真',
          },
        },
      },
    };
    expect(parseSignageA2uiProposal({ layoutMessage: imageLayout, dataMessage: unsafeData })).toBeUndefined();
  });
});
