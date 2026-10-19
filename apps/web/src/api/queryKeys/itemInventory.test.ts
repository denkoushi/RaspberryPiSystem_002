import { describe, expect, it } from 'vitest';

import { inventoryKeys, itemInventoryQueryKeys } from './itemInventory';

describe('itemInventoryQueryKeys', () => {
  it('preserves constant values and prefix lengths', () => {
    expect(inventoryKeys.dashboardAll).toEqual(['inventory-dashboard']);
    expect(inventoryKeys.variantsAll).toEqual(['inventory-value-variants']);
    expect(inventoryKeys.itemsAll).toEqual(['inventory-items']);
    expect(inventoryKeys.locationsAll).toEqual(['inventory-locations']);
    expect(inventoryKeys.tagsAll).toEqual(['inventory-tags']);
    expect(inventoryKeys.importsAll).toEqual(['inventory-imports']);
    expect(inventoryKeys.importSummariesAll).toEqual(['inventory-imports', 'summaries']);
    expect(inventoryKeys.historyAll).toEqual(['inventory-history']);
    expect(inventoryKeys.importMessagesAll).toEqual(['inventory-import-messages']);
    expect(inventoryKeys.unitsAll).toEqual(['inventory-units']);
    expect(inventoryKeys.toolFieldOptionsAll).toEqual(['inventory-tool-field-options']);
    expect(inventoryKeys.toolFieldValuesAll).toEqual(['inventory-tool-field-values']);
  });

  it('preserves toolFieldValuesSetup values, order and boundary arguments', () => {
    expect(itemInventoryQueryKeys.toolFieldValuesSetup(5)).toEqual(['inventory-tool-field-values', 'setup', 5]);
    expect(Reflect.apply(itemInventoryQueryKeys.toolFieldValuesSetup, undefined, [undefined])).toEqual(['inventory-tool-field-values', 'setup', undefined]);
    expect(Reflect.apply(itemInventoryQueryKeys.toolFieldValuesSetup, undefined, [null])).toEqual(['inventory-tool-field-values', 'setup', null]);
    expect(Reflect.apply(itemInventoryQueryKeys.toolFieldValuesSetup, undefined, [{}])).toEqual(['inventory-tool-field-values', 'setup', {}]);
    expect(Reflect.apply(itemInventoryQueryKeys.toolFieldValuesSetup, undefined, [''])).toEqual(['inventory-tool-field-values', 'setup', '']);
    expect(Reflect.apply(itemInventoryQueryKeys.toolFieldValuesSetup, undefined, [])).toEqual(['inventory-tool-field-values', 'setup', undefined]);
  });

  it('preserves importsSetup values, order and boundary arguments', () => {
    expect(itemInventoryQueryKeys.importsSetup(6)).toEqual(['inventory-imports', 'setup', 6]);
    expect(Reflect.apply(itemInventoryQueryKeys.importsSetup, undefined, [undefined])).toEqual(['inventory-imports', 'setup', undefined]);
    expect(Reflect.apply(itemInventoryQueryKeys.importsSetup, undefined, [null])).toEqual(['inventory-imports', 'setup', null]);
    expect(Reflect.apply(itemInventoryQueryKeys.importsSetup, undefined, [{}])).toEqual(['inventory-imports', 'setup', {}]);
    expect(Reflect.apply(itemInventoryQueryKeys.importsSetup, undefined, [''])).toEqual(['inventory-imports', 'setup', '']);
    expect(Reflect.apply(itemInventoryQueryKeys.importsSetup, undefined, [])).toEqual(['inventory-imports', 'setup', undefined]);
  });

  it('preserves importMessagesSetup values, order and boundary arguments', () => {
    expect(itemInventoryQueryKeys.importMessagesSetup(7)).toEqual(['inventory-import-messages', 'setup', 7]);
    expect(Reflect.apply(itemInventoryQueryKeys.importMessagesSetup, undefined, [undefined])).toEqual(['inventory-import-messages', 'setup', undefined]);
    expect(Reflect.apply(itemInventoryQueryKeys.importMessagesSetup, undefined, [null])).toEqual(['inventory-import-messages', 'setup', null]);
    expect(Reflect.apply(itemInventoryQueryKeys.importMessagesSetup, undefined, [{}])).toEqual(['inventory-import-messages', 'setup', {}]);
    expect(Reflect.apply(itemInventoryQueryKeys.importMessagesSetup, undefined, [''])).toEqual(['inventory-import-messages', 'setup', '']);
    expect(Reflect.apply(itemInventoryQueryKeys.importMessagesSetup, undefined, [])).toEqual(['inventory-import-messages', 'setup', undefined]);
  });

  it('preserves compartmentHistory values, order and boundary arguments', () => {
    expect(itemInventoryQueryKeys.compartmentHistory('compartment-1', 3)).toEqual(['inventory-history', 'compartment-1', 3]);
    expect(Reflect.apply(itemInventoryQueryKeys.compartmentHistory, undefined, [undefined, undefined])).toEqual(['inventory-history', undefined, undefined]);
    expect(Reflect.apply(itemInventoryQueryKeys.compartmentHistory, undefined, [null, null])).toEqual(['inventory-history', null, null]);
    expect(Reflect.apply(itemInventoryQueryKeys.compartmentHistory, undefined, [{}, {}])).toEqual(['inventory-history', {}, {}]);
    expect(Reflect.apply(itemInventoryQueryKeys.compartmentHistory, undefined, ['', ''])).toEqual(['inventory-history', '', '']);
    expect(Reflect.apply(itemInventoryQueryKeys.compartmentHistory, undefined, [])).toEqual(['inventory-history', undefined, undefined]);
    expect(Reflect.apply(itemInventoryQueryKeys.compartmentHistory, undefined, ['compartment-1'])).toEqual(['inventory-history', 'compartment-1', undefined]);
    expect(Reflect.apply(itemInventoryQueryKeys.compartmentHistory, undefined, [undefined, 3])).toEqual(['inventory-history', undefined, 3]);
  });

  it('preserves tag values, order and boundary arguments', () => {
    expect(itemInventoryQueryKeys.tag('uid-1')).toEqual(['inventory-tag', 'uid-1']);
    expect(Reflect.apply(itemInventoryQueryKeys.tag, undefined, [undefined])).toEqual(['inventory-tag', undefined]);
    expect(Reflect.apply(itemInventoryQueryKeys.tag, undefined, [null])).toEqual(['inventory-tag', null]);
    expect(Reflect.apply(itemInventoryQueryKeys.tag, undefined, [{}])).toEqual(['inventory-tag', {}]);
    expect(Reflect.apply(itemInventoryQueryKeys.tag, undefined, [''])).toEqual(['inventory-tag', '']);
    expect(Reflect.apply(itemInventoryQueryKeys.tag, undefined, [])).toEqual(['inventory-tag', undefined]);
  });

  it('preserves label values, order and boundary arguments', () => {
    expect(itemInventoryQueryKeys.label('123')).toEqual(['inventory-label', '123']);
    expect(Reflect.apply(itemInventoryQueryKeys.label, undefined, [undefined])).toEqual(['inventory-label', undefined]);
    expect(Reflect.apply(itemInventoryQueryKeys.label, undefined, [null])).toEqual(['inventory-label', null]);
    expect(Reflect.apply(itemInventoryQueryKeys.label, undefined, [{}])).toEqual(['inventory-label', {}]);
    expect(Reflect.apply(itemInventoryQueryKeys.label, undefined, [''])).toEqual(['inventory-label', '']);
    expect(Reflect.apply(itemInventoryQueryKeys.label, undefined, [])).toEqual(['inventory-label', undefined]);
  });

  it('preserves dashboard values, order and boundary arguments', () => {
    expect(itemInventoryQueryKeys.dashboard(4, 'machine-1')).toEqual(['inventory-dashboard', 4, 'machine-1']);
    expect(Reflect.apply(itemInventoryQueryKeys.dashboard, undefined, [undefined, undefined])).toEqual(['inventory-dashboard', undefined, undefined]);
    expect(Reflect.apply(itemInventoryQueryKeys.dashboard, undefined, [null, null])).toEqual(['inventory-dashboard', null, null]);
    expect(Reflect.apply(itemInventoryQueryKeys.dashboard, undefined, [{}, {}])).toEqual(['inventory-dashboard', {}, {}]);
    expect(Reflect.apply(itemInventoryQueryKeys.dashboard, undefined, ['', ''])).toEqual(['inventory-dashboard', '', '']);
    expect(Reflect.apply(itemInventoryQueryKeys.dashboard, undefined, [])).toEqual(['inventory-dashboard', undefined, undefined]);
    expect(Reflect.apply(itemInventoryQueryKeys.dashboard, undefined, [4])).toEqual(['inventory-dashboard', 4, undefined]);
    expect(Reflect.apply(itemInventoryQueryKeys.dashboard, undefined, [undefined, 'machine-1'])).toEqual(['inventory-dashboard', undefined, 'machine-1']);
  });

  it('preserves the bulk invalidation keys and their order', () => {
    expect(Object.values(inventoryKeys)).toEqual([
      ['inventory-dashboard'],
      ['inventory-value-variants'],
      ['inventory-items'],
      ['inventory-locations'],
      ['inventory-tags'],
      ['inventory-imports'],
      ['inventory-imports', 'summaries'],
      ['inventory-history'],
      ['inventory-import-messages'],
      ['inventory-units'],
      ['inventory-tool-field-options'],
      ['inventory-tool-field-values'],
    ]);
  });
});
