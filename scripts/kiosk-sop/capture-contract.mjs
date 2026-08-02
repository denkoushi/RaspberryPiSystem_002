function contextLabel({ scenarioId, sheetId, targetId }) {
  return `scenario=${scenarioId} sheet=${sheetId} targetId=${targetId}`;
}

export function assertNoManualTarget(step, context) {
  if (Object.prototype.hasOwnProperty.call(step, 'target')) {
    throw new Error(`Manual target coordinates are forbidden (${contextLabel(context)})`);
  }
}

export function resolveSingleVisibleTarget(rows, context) {
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one DOM target, found ${rows.length} (${contextLabel(context)})`);
  }
  const [row] = rows;
  if (!row.visible) {
    throw new Error(`DOM target is not visible: ${JSON.stringify(row)} (${contextLabel(context)})`);
  }
  if (!(row.rect.width > 0) || !(row.rect.height > 0)) {
    throw new Error(`DOM target has zero dimensions (${contextLabel(context)})`);
  }
  return row.rect;
}
