import { describe, expect, it } from 'vitest';

import { tagDeskQueryKeys } from './tagDesk';

describe('tagDeskQueryKeys', () => {
  it('preserves constant values and prefix lengths', () => {
    expect(tagDeskQueryKeys.registryAll).toEqual(['kiosk-tag-desk', 'registry']);
    expect(tagDeskQueryKeys.optionsAll).toEqual(['kiosk-tag-desk', 'options']);
    expect(tagDeskQueryKeys.eventsAll).toEqual(['kiosk-tag-desk', 'events']);
    expect(tagDeskQueryKeys.tagAll).toEqual(['kiosk-tag-desk', 'tag']);
    expect(tagDeskQueryKeys.positionRanksAll).toEqual(['kiosk-tag-desk', 'position-ranks']);
  });

  it('preserves section values, order and boundary arguments', () => {
    expect(tagDeskQueryKeys.section('position-ranks')).toEqual(['kiosk-tag-desk', 'position-ranks']);
    expect(Reflect.apply(tagDeskQueryKeys.section, undefined, [undefined])).toEqual(['kiosk-tag-desk', undefined]);
    expect(Reflect.apply(tagDeskQueryKeys.section, undefined, [null])).toEqual(['kiosk-tag-desk', null]);
    expect(Reflect.apply(tagDeskQueryKeys.section, undefined, [{}])).toEqual(['kiosk-tag-desk', {}]);
    expect(Reflect.apply(tagDeskQueryKeys.section, undefined, [''])).toEqual(['kiosk-tag-desk', '']);
    expect(Reflect.apply(tagDeskQueryKeys.section, undefined, [])).toEqual(['kiosk-tag-desk', undefined]);
  });

  it('preserves registry values, order and boundary arguments', () => {
    expect(tagDeskQueryKeys.registry('employee')).toEqual(['kiosk-tag-desk', 'registry', 'employee']);
    expect(Reflect.apply(tagDeskQueryKeys.registry, undefined, [undefined])).toEqual(['kiosk-tag-desk', 'registry', undefined]);
    expect(Reflect.apply(tagDeskQueryKeys.registry, undefined, [null])).toEqual(['kiosk-tag-desk', 'registry', null]);
    expect(Reflect.apply(tagDeskQueryKeys.registry, undefined, [{}])).toEqual(['kiosk-tag-desk', 'registry', {}]);
    expect(Reflect.apply(tagDeskQueryKeys.registry, undefined, [''])).toEqual(['kiosk-tag-desk', 'registry', '']);
    expect(Reflect.apply(tagDeskQueryKeys.registry, undefined, [])).toEqual(['kiosk-tag-desk', 'registry', undefined]);
  });

  it('preserves tag values, order and boundary arguments', () => {
    expect(tagDeskQueryKeys.tag('uid-1')).toEqual(['kiosk-tag-desk', 'tag', 'uid-1']);
    expect(Reflect.apply(tagDeskQueryKeys.tag, undefined, [undefined])).toEqual(['kiosk-tag-desk', 'tag', undefined]);
    expect(Reflect.apply(tagDeskQueryKeys.tag, undefined, [null])).toEqual(['kiosk-tag-desk', 'tag', null]);
    expect(Reflect.apply(tagDeskQueryKeys.tag, undefined, [{}])).toEqual(['kiosk-tag-desk', 'tag', {}]);
    expect(Reflect.apply(tagDeskQueryKeys.tag, undefined, [''])).toEqual(['kiosk-tag-desk', 'tag', '']);
    expect(Reflect.apply(tagDeskQueryKeys.tag, undefined, [])).toEqual(['kiosk-tag-desk', 'tag', undefined]);
  });

  it('preserves riggingInspections values, order and boundary arguments', () => {
    expect(tagDeskQueryKeys.riggingInspections('gear-1')).toEqual(['kiosk-tag-desk', 'rigging-inspections', 'gear-1']);
    expect(Reflect.apply(tagDeskQueryKeys.riggingInspections, undefined, [undefined])).toEqual(['kiosk-tag-desk', 'rigging-inspections', undefined]);
    expect(Reflect.apply(tagDeskQueryKeys.riggingInspections, undefined, [null])).toEqual(['kiosk-tag-desk', 'rigging-inspections', null]);
    expect(Reflect.apply(tagDeskQueryKeys.riggingInspections, undefined, [{}])).toEqual(['kiosk-tag-desk', 'rigging-inspections', {}]);
    expect(Reflect.apply(tagDeskQueryKeys.riggingInspections, undefined, [''])).toEqual(['kiosk-tag-desk', 'rigging-inspections', '']);
    expect(Reflect.apply(tagDeskQueryKeys.riggingInspections, undefined, [])).toEqual(['kiosk-tag-desk', 'rigging-inspections', undefined]);
  });

  it('preserves position rank invalidation order', () => {
    expect(['position-ranks', 'registry', 'options', 'tag'].map(key => tagDeskQueryKeys.section(key))).toEqual([
      ['kiosk-tag-desk', 'position-ranks'],
      ['kiosk-tag-desk', 'registry'],
      ['kiosk-tag-desk', 'options'],
      ['kiosk-tag-desk', 'tag'],
    ]);
  });
});
